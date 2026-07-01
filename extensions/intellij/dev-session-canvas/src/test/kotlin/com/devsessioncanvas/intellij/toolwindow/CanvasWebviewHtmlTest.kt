package com.devsessioncanvas.intellij.toolwindow

import kotlin.test.Test
import kotlin.test.assertContains

class CanvasWebviewHtmlTest {
    @Test
    fun escapesC1ControlsBeforePostingToJcefQuery() {
        val html = CanvasWebviewHtml.renderDocument(
            javascript = "window.__bundle = true;",
            stylesheet = ".dsc-root {}",
            bridgeScript = "window.__payload = payload;"
        )

        assertContains(html, "escapeDevSessionCanvasBridgePayload(JSON.stringify(message))")
        assertContains(html, "json.replace(/[\\u007f-\\u009f]/g")
        assertContains(html, "\\\\u\" + character.charCodeAt(0).toString(16).padStart(4, \"0\")")
    }
}
