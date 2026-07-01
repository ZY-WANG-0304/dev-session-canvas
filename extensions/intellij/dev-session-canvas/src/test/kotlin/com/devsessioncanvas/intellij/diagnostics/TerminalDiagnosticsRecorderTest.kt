package com.devsessioncanvas.intellij.diagnostics

import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertContains
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class TerminalDiagnosticsRecorderTest {
    @Test
    fun recordsTerminalDiagnosticsToJsonLines() {
        val logDirectory = Files.createTempDirectory("dsc-terminal-diagnostics")
        val recorder = TerminalDiagnosticsRecorder(logDirectory)

        val enabled = recorder.setEnabled(true)
        recorder.recordHostText("terminal.input.host-received", "terminal-1", "\u007f\u0098a")
        recorder.recordWebviewEntry("terminal-1", """{"event":"keydown","key":"Backspace"}""")
        val disabled = recorder.setEnabled(false)

        assertTrue(enabled.enabled)
        assertTrue(enabled.path.endsWith(".jsonl"))
        assertFalse(disabled.enabled)
        assertEquals(enabled.path, disabled.path)

        val lines = Files.list(logDirectory).use { paths ->
            Files.readAllLines(paths.findFirst().orElseThrow())
        }
        assertContains(lines.first(), "\"event\":\"diagnostics.enabled\"")
        assertContains(lines.joinToString("\n"), "\"event\":\"terminal.input.host-received\"")
        assertContains(lines.joinToString("\n"), "\"codes\":\"U+007F U+0098 U+0061\"")
        assertContains(lines.joinToString("\n"), "\"text\":\"\\u007f\\u0098a\"")
        assertContains(lines.joinToString("\n"), "\"source\":\"webview\"")
        assertContains(lines.last(), "\"event\":\"diagnostics.disabled\"")
    }
}
