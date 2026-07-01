package com.devsessioncanvas.intellij.execution

import com.pty4j.PtyProcess
import com.pty4j.WinSize
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.io.OutputStream
import java.io.PipedInputStream
import java.io.PipedOutputStream
import java.util.concurrent.CountDownLatch
import kotlin.test.Test
import kotlin.test.assertContains
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class ExecutionSessionManagerTest {
    @Test
    fun startsTerminalWithNormalizedInitialSize() {
        val fakeProcess = FakePtyProcess()
        val factory = RecordingPtyProcessFactory(fakeProcess)
        val listener = RecordingTerminalSessionListener()
        val manager = ExecutionSessionManager(listener = listener, processFactory = factory)

        try {
            manager.startTerminal(id = "terminal-1", cwd = "/tmp/project", shellPath = "/bin/sh", cols = 1, rows = 999)

            assertEquals(listOf("started:terminal-1"), listener.events)
            assertEquals(listOf("/bin/sh"), factory.command?.toList())
            assertEquals("/tmp/project", factory.cwd)
            assertEquals(20, factory.cols)
            assertEquals(80, factory.rows)
        } finally {
            manager.dispose()
        }
    }

    @Test
    fun writesInputAndResizesPty() {
        val fakeProcess = FakePtyProcess()
        val manager = ExecutionSessionManager(
            listener = RecordingTerminalSessionListener(),
            processFactory = RecordingPtyProcessFactory(fakeProcess)
        )

        try {
            manager.startTerminal(id = "terminal-1", cwd = "/tmp/project", shellPath = "/bin/sh", cols = 80, rows = 24)
            manager.sendInput("terminal-1", "echo hi\r")
            manager.resizeTerminal("terminal-1", cols = 999, rows = 1)

            assertEquals("echo hi\r", fakeProcess.writtenInput())
            assertEquals(240, fakeProcess.lastWinSize.columns)
            assertEquals(4, fakeProcess.lastWinSize.rows)
        } finally {
            manager.dispose()
        }
    }

    @Test
    fun addsUtf8LocaleWhenHostEnvironmentDoesNotProvideOne() {
        val fakeProcess = FakePtyProcess()
        val factory = RecordingPtyProcessFactory(fakeProcess)
        val manager = ExecutionSessionManager(
            listener = RecordingTerminalSessionListener(),
            processFactory = factory,
            environmentProvider = { mapOf("PATH" to "/usr/bin") }
        )

        try {
            manager.startTerminal(id = "terminal-1", cwd = "/tmp/project", shellPath = "/bin/sh", cols = 80, rows = 24)

            assertEquals("xterm-256color", factory.environment?.get("TERM"))
            assertTrue(factory.environment?.get("LC_CTYPE")?.contains("UTF-8") == true)
        } finally {
            manager.dispose()
        }
    }

    @Test
    fun keepsExistingUtf8Locale() {
        val fakeProcess = FakePtyProcess()
        val factory = RecordingPtyProcessFactory(fakeProcess)
        val manager = ExecutionSessionManager(
            listener = RecordingTerminalSessionListener(),
            processFactory = factory,
            environmentProvider = { mapOf("LANG" to "en_US.UTF-8", "TERM" to "screen-256color") }
        )

        try {
            manager.startTerminal(id = "terminal-1", cwd = "/tmp/project", shellPath = "/bin/sh", cols = 80, rows = 24)

            assertEquals("screen-256color", factory.environment?.get("TERM"))
            assertEquals("en_US.UTF-8", factory.environment?.get("LANG"))
            assertEquals(null, factory.environment?.get("LC_CTYPE"))
        } finally {
            manager.dispose()
        }
    }

    @Test
    fun pumpsOutputAndReportsNaturalExit() {
        val fakeProcess = FakePtyProcess()
        val listener = RecordingTerminalSessionListener()
        val manager = ExecutionSessionManager(
            listener = listener,
            processFactory = RecordingPtyProcessFactory(fakeProcess)
        )

        try {
            manager.startTerminal(id = "terminal-1", cwd = "/tmp/project", shellPath = "/bin/sh", cols = 80, rows = 24)
            fakeProcess.emit("hello\n")
            assertTrue(waitUntil { listener.outputs.contains("terminal-1" to "hello\n") })

            fakeProcess.complete(exitCode = 0)
            assertTrue(waitUntil { listener.exits.any { it.id == "terminal-1" && it.status == "closed" } })
            val exit = listener.exits.single { it.id == "terminal-1" }
            assertEquals(0, exit.exitCode)
            assertContains(exit.message, "code 0")
        } finally {
            manager.dispose()
        }
    }

    @Test
    fun decodesUtf8OutputAcrossReadChunks() {
        val fakeProcess = FakePtyProcess()
        val listener = RecordingTerminalSessionListener()
        val manager = ExecutionSessionManager(
            listener = listener,
            processFactory = RecordingPtyProcessFactory(fakeProcess)
        )

        try {
            manager.startTerminal(id = "terminal-1", cwd = "/tmp/project", shellPath = "/bin/sh", cols = 80, rows = 24)
            fakeProcess.emitBytes("你".toByteArray(Charsets.UTF_8).copyOfRange(0, 1))
            Thread.sleep(20)
            fakeProcess.emitBytes("你".toByteArray(Charsets.UTF_8).copyOfRange(1, 3))

            assertTrue(waitUntil { listener.joinedOutput() == "你" })
        } finally {
            manager.dispose()
        }
    }

    @Test
    fun stopsActiveTerminal() {
        val fakeProcess = FakePtyProcess()
        val listener = RecordingTerminalSessionListener()
        val manager = ExecutionSessionManager(
            listener = listener,
            processFactory = RecordingPtyProcessFactory(fakeProcess)
        )

        try {
            manager.startTerminal(id = "terminal-1", cwd = "/tmp/project", shellPath = "/bin/sh", cols = 80, rows = 24)
            manager.stopTerminal("terminal-1")

            assertTrue(fakeProcess.destroyed)
            val exit = listener.exits.single { it.id == "terminal-1" }
            assertEquals("stopped", exit.status)
            assertEquals("Terminal stopped by host.", exit.message)
        } finally {
            manager.dispose()
        }
    }

    @Test
    fun reportsStartFailure() {
        val listener = RecordingTerminalSessionListener()
        val manager = ExecutionSessionManager(
            listener = listener,
            processFactory = ThrowingPtyProcessFactory()
        )

        manager.startTerminal(id = "terminal-1", cwd = "/tmp/project", shellPath = "/missing/shell", cols = 80, rows = 24)

        val exit = listener.exits.single()
        assertEquals("failed", exit.status)
        assertNotNull(exit.message)
        assertContains(exit.message, "/missing/shell")
    }

    private fun waitUntil(predicate: () -> Boolean): Boolean {
        repeat(50) {
            if (predicate()) {
                return true
            }
            Thread.sleep(20)
        }
        return predicate()
    }
}

private class RecordingTerminalSessionListener : TerminalSessionListener {
    val events = mutableListOf<String>()
    val outputs = mutableListOf<Pair<String, String>>()
    val exits = mutableListOf<TerminalExitRecord>()

    override fun onTerminalStarted(id: String) {
        synchronized(this) {
            events.add("started:$id")
        }
    }

    override fun onTerminalOutput(id: String, text: String) {
        synchronized(this) {
            outputs.add(id to text)
        }
    }

    override fun onTerminalExit(id: String, status: String, exitCode: Int?, message: String) {
        synchronized(this) {
            exits.add(TerminalExitRecord(id = id, status = status, exitCode = exitCode, message = message))
        }
    }

    fun joinedOutput(): String {
        synchronized(this) {
            return outputs.joinToString("") { it.second }
        }
    }
}

private data class TerminalExitRecord(
    val id: String,
    val status: String,
    val exitCode: Int?,
    val message: String
)

private class RecordingPtyProcessFactory(private val process: PtyProcess) : PtyProcessFactory {
    var command: Array<String>? = null
    var cwd: String? = null
    var environment: Map<String, String>? = null
    var cols: Int? = null
    var rows: Int? = null

    override fun start(
        command: Array<String>,
        cwd: String,
        environment: Map<String, String>,
        cols: Int,
        rows: Int
    ): PtyProcess {
        this.command = command
        this.cwd = cwd
        this.environment = environment
        this.cols = cols
        this.rows = rows
        return process
    }
}

private class ThrowingPtyProcessFactory : PtyProcessFactory {
    override fun start(
        command: Array<String>,
        cwd: String,
        environment: Map<String, String>,
        cols: Int,
        rows: Int
    ): PtyProcess {
        error("boom")
    }
}

@Suppress("OVERRIDE_DEPRECATION")
private class FakePtyProcess : PtyProcess() {
    private val processInput = PipedInputStream()
    private val processOutput = PipedOutputStream(processInput)
    private val stdin = ByteArrayOutputStream()
    private val waitLatch = CountDownLatch(1)
    @Volatile private var alive = true
    @Volatile private var exitCode = 0
    @Volatile var destroyed = false
    @Volatile var forciblyDestroyed = false
    @Volatile var lastWinSize = WinSize(80, 24)

    override fun getOutputStream(): OutputStream = stdin

    override fun getInputStream(): InputStream = processInput

    override fun getErrorStream(): InputStream = ByteArrayInputStream(ByteArray(0))

    override fun waitFor(): Int {
        waitLatch.await()
        return exitCode
    }

    override fun exitValue(): Int {
        if (alive) {
            throw IllegalThreadStateException("process is still running")
        }
        return exitCode
    }

    override fun destroy() {
        destroyed = true
        complete(exitCode = 143)
    }

    override fun destroyForcibly(): Process {
        forciblyDestroyed = true
        destroy()
        return this
    }

    override fun isAlive(): Boolean = alive

    override fun isRunning(): Boolean = alive

    override fun setWinSize(winSize: WinSize) {
        lastWinSize = winSize
    }

    override fun getWinSize(): WinSize = lastWinSize

    fun emit(text: String) {
        emitBytes(text.toByteArray(Charsets.UTF_8))
    }

    fun emitBytes(bytes: ByteArray) {
        processOutput.write(bytes)
        processOutput.flush()
    }

    fun complete(exitCode: Int) {
        if (!alive) {
            return
        }
        this.exitCode = exitCode
        alive = false
        processOutput.close()
        waitLatch.countDown()
    }

    fun writtenInput(): String = stdin.toString(Charsets.UTF_8)
}
