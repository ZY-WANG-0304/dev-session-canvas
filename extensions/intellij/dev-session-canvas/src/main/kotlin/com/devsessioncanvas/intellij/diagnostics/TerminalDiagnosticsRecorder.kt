package com.devsessioncanvas.intellij.diagnostics

import com.devsessioncanvas.intellij.protocol.CanvasProtocol
import com.devsessioncanvas.intellij.protocol.TerminalDiagnosticsStatusPayload
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.PathManager
import java.io.BufferedWriter
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.Paths
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter

class TerminalDiagnosticsRecorder(
    private val logDirectory: Path = Paths.get(PathManager.getLogPath()).resolve("dev-session-canvas")
) : Disposable {
    private val lock = Any()
    private var writer: BufferedWriter? = null
    private var currentPath: Path? = null
    @Volatile private var enabled = false

    fun status(message: String = ""): TerminalDiagnosticsStatusPayload {
        synchronized(lock) {
            return TerminalDiagnosticsStatusPayload(
                enabled = enabled,
                path = currentPath?.toAbsolutePath()?.toString().orEmpty(),
                message = message
            )
        }
    }

    fun setEnabled(nextEnabled: Boolean): TerminalDiagnosticsStatusPayload {
        synchronized(lock) {
            try {
                if (nextEnabled && !enabled) {
                    Files.createDirectories(logDirectory)
                    currentPath = logDirectory.resolve("terminal-input-${fileTimestamp()}.jsonl")
                    writer = Files.newBufferedWriter(currentPath, StandardCharsets.UTF_8)
                    enabled = true
                    val firstLineWritten = writeLineLocked(
                        buildJsonLine(
                            source = "host",
                            event = "diagnostics.enabled",
                            id = null,
                            fields = mapOf("path" to currentPath?.toAbsolutePath()?.toString().orEmpty())
                        )
                    )
                    if (!firstLineWritten) {
                        return status("Terminal diagnostics failed: unable to write log file.")
                    }
                    return status("Terminal diagnostics enabled.")
                }
                if (!nextEnabled && enabled) {
                    writeLineLocked(buildJsonLine(source = "host", event = "diagnostics.disabled", id = null))
                    closeWriterLocked()
                    enabled = false
                    return status("Terminal diagnostics disabled.")
                }
                return status(if (enabled) "Terminal diagnostics already enabled." else "Terminal diagnostics already disabled.")
            } catch (error: Throwable) {
                closeWriterLocked()
                enabled = false
                currentPath = null
                return status("Terminal diagnostics failed: ${error.message ?: error.javaClass.simpleName}")
            }
        }
    }

    fun recordWebviewEntry(id: String?, entry: String) {
        if (!enabled) {
            return
        }
        synchronized(lock) {
            if (!enabled) {
                return
            }
            writeLineLocked(
                buildJsonLine(
                    source = "webview",
                    event = "webview.entry",
                    id = id,
                    fields = mapOf("entry" to entry)
                )
            )
        }
    }

    fun recordHostText(event: String, id: String?, text: String) {
        if (!enabled) {
            return
        }
        synchronized(lock) {
            if (!enabled) {
                return
            }
            writeLineLocked(
                buildJsonLine(
                    source = "host",
                    event = event,
                    id = id,
                    fields = mapOf(
                        "length" to text.length.toString(),
                        "codes" to text.asCodePoints(),
                        "text" to text.asLogText(),
                        "truncated" to (text.length > MAX_LOG_TEXT_CHARS).toString()
                    )
                )
            )
        }
    }

    fun recordHostEvent(event: String, id: String? = null, fields: Map<String, String> = emptyMap()) {
        if (!enabled) {
            return
        }
        synchronized(lock) {
            if (!enabled) {
                return
            }
            writeLineLocked(buildJsonLine(source = "host", event = event, id = id, fields = fields))
        }
    }

    override fun dispose() {
        synchronized(lock) {
            if (enabled) {
                writeLineLocked(buildJsonLine(source = "host", event = "diagnostics.disposed", id = null))
            }
            closeWriterLocked()
            enabled = false
        }
    }

    private fun writeLineLocked(line: String): Boolean {
        val activeWriter = writer ?: return false
        try {
            activeWriter.write(line)
            activeWriter.newLine()
            activeWriter.flush()
            return true
        } catch (_: Throwable) {
            closeWriterLocked()
            enabled = false
            return false
        }
    }

    private fun closeWriterLocked() {
        try {
            writer?.close()
        } catch (_: Throwable) {
            // Diagnostics must not affect Terminal behavior.
        }
        writer = null
    }

    private fun buildJsonLine(
        source: String,
        event: String,
        id: String?,
        fields: Map<String, String> = emptyMap()
    ): String {
        val extraFields = fields.entries.joinToString("") { (key, value) ->
            ",${CanvasProtocol.jsonText(key)}:${CanvasProtocol.jsonText(value)}"
        }
        return buildString {
            append('{')
            append("\"time\":")
            append(CanvasProtocol.jsonText(Instant.now().toString()))
            append(",\"source\":")
            append(CanvasProtocol.jsonText(source))
            append(",\"event\":")
            append(CanvasProtocol.jsonText(event))
            append(",\"id\":")
            append(id?.let(CanvasProtocol::jsonText) ?: "null")
            append(extraFields)
            append('}')
        }
    }

    private fun fileTimestamp(): String = DateTimeFormatter
        .ofPattern("yyyyMMdd-HHmmss-SSS")
        .withZone(ZoneOffset.UTC)
        .format(Instant.now())

    private fun String.asLogText(): String {
        return if (length <= MAX_LOG_TEXT_CHARS) this else "${take(MAX_LOG_TEXT_CHARS)}..."
    }

    private fun String.asCodePoints(): String {
        return codePoints()
            .limit(MAX_LOG_CODE_POINTS.toLong())
            .toArray()
            .joinToString(" ") { codePoint -> "U+${codePoint.toString(16).uppercase().padStart(4, '0')}" }
    }

    private companion object {
        const val MAX_LOG_TEXT_CHARS = 512
        const val MAX_LOG_CODE_POINTS = 64
    }
}
