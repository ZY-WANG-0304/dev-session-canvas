package com.devsessioncanvas.intellij.execution

import com.devsessioncanvas.intellij.state.CanvasProjectStateService
import com.intellij.openapi.Disposable
import com.pty4j.PtyProcess
import com.pty4j.PtyProcessBuilder
import com.pty4j.WinSize
import java.io.IOException
import java.nio.charset.StandardCharsets
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class ExecutionSessionManager(
    private val listener: TerminalSessionListener,
    private val processFactory: PtyProcessFactory = DefaultPtyProcessFactory()
) : Disposable {
    private val executor: ExecutorService = Executors.newCachedThreadPool { runnable ->
        Thread(runnable, "DevSessionCanvas IntelliJ terminal").apply { isDaemon = true }
    }
    private val sessions = ConcurrentHashMap<String, TerminalSession>()

    fun startTerminal(id: String, cwd: String, shellPath: String, cols: Int, rows: Int) {
        stopTerminal(id)
        try {
            val process = processFactory.start(
                command = arrayOf(shellPath),
                cwd = cwd,
                environment = System.getenv(),
                cols = CanvasProjectStateService.normalizeTerminalCols(cols),
                rows = CanvasProjectStateService.normalizeTerminalRows(rows)
            )
            val session = TerminalSession(id = id, process = process)
            sessions[id] = session
            listener.onTerminalStarted(id)
            pumpOutput(session)
            waitForExit(session)
        } catch (error: Throwable) {
            listener.onTerminalExit(id, "failed", null, describeStartError(shellPath, cwd, error))
        }
    }

    fun sendInput(id: String, text: String) {
        val process = sessions[id]?.process ?: return
        try {
            process.outputStream.write(text.toByteArray(StandardCharsets.UTF_8))
            process.outputStream.flush()
        } catch (error: IOException) {
            listener.onTerminalExit(id, "failed", null, "Terminal input failed: ${error.message ?: error.javaClass.simpleName}")
        }
    }

    fun resizeTerminal(id: String, cols: Int, rows: Int) {
        val process = sessions[id]?.process ?: return
        val normalizedCols = CanvasProjectStateService.normalizeTerminalCols(cols)
        val normalizedRows = CanvasProjectStateService.normalizeTerminalRows(rows)
        try {
            process.setWinSize(WinSize(normalizedCols, normalizedRows))
        } catch (_: Throwable) {
            // Resize failures should not kill the PTY session; the next resize can still succeed.
        }
    }

    fun stopTerminal(id: String) {
        sessions.remove(id)?.let { session ->
            session.closedByHost = true
            session.process.destroy()
            if (session.process.isAlive) {
                session.process.destroyForcibly()
            }
            listener.onTerminalExit(id, "stopped", null, "Terminal stopped by host.")
        }
    }

    override fun dispose() {
        val ids = sessions.keys.toList()
        ids.forEach(::stopTerminal)
        executor.shutdownNow()
        executor.awaitTermination(2, TimeUnit.SECONDS)
    }

    private fun pumpOutput(session: TerminalSession) {
        executor.execute {
            val buffer = ByteArray(8192)
            try {
                while (!session.closedByHost) {
                    val read = session.process.inputStream.read(buffer)
                    if (read < 0) {
                        break
                    }
                    if (read > 0) {
                        listener.onTerminalOutput(
                            session.id,
                            String(buffer, 0, read, StandardCharsets.UTF_8)
                        )
                    }
                }
            } catch (_: IOException) {
                // Process exit commonly closes the stream; waitForExit publishes the final state.
            }
        }
    }

    private fun waitForExit(session: TerminalSession) {
        executor.execute {
            val exitCode = try {
                session.process.waitFor()
            } catch (_: InterruptedException) {
                Thread.currentThread().interrupt()
                null
            }
            if (sessions.remove(session.id, session) && !session.closedByHost) {
                listener.onTerminalExit(session.id, "closed", exitCode, "Terminal exited${exitCode?.let { " with code $it" } ?: ""}.")
            }
        }
    }

    private fun describeStartError(shellPath: String, cwd: String, error: Throwable): String {
        val message = error.message ?: error.javaClass.simpleName
        return "Unable to start terminal shell $shellPath in $cwd: $message"
    }
}

interface TerminalSessionListener {
    fun onTerminalStarted(id: String)
    fun onTerminalOutput(id: String, text: String)
    fun onTerminalExit(id: String, status: String, exitCode: Int?, message: String)
}

interface PtyProcessFactory {
    fun start(
        command: Array<String>,
        cwd: String,
        environment: Map<String, String>,
        cols: Int,
        rows: Int
    ): PtyProcess
}

class DefaultPtyProcessFactory : PtyProcessFactory {
    override fun start(
        command: Array<String>,
        cwd: String,
        environment: Map<String, String>,
        cols: Int,
        rows: Int
    ): PtyProcess {
        return PtyProcessBuilder(command)
            .setDirectory(cwd)
            .setEnvironment(environment)
            .setInitialColumns(cols)
            .setInitialRows(rows)
            .setRedirectErrorStream(true)
            .start()
    }
}

private data class TerminalSession(
    val id: String,
    val process: PtyProcess,
    @Volatile var closedByHost: Boolean = false
)
