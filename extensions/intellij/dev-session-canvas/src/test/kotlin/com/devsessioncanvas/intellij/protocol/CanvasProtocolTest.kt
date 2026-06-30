package com.devsessioncanvas.intellij.protocol

import kotlin.test.Test
import kotlin.test.assertContains
import kotlin.test.assertEquals
import kotlin.test.assertNull

class CanvasProtocolTest {
    @Test
    fun decodesKnownWebviewMessagesWithWhitespace() {
        val ready = CanvasProtocol.decodeWebviewMessage("""{ "type" : "webview/ready" }""")
        val createNote = CanvasProtocol.decodeWebviewMessage("""{"type":"webview/createNote","payload":{}}""")

        assertEquals(WebviewMessage(WebviewMessageType.Ready), ready)
        assertEquals(WebviewMessage(WebviewMessageType.CreateNote), createNote)
    }

    @Test
    fun rejectsUnknownWebviewMessages() {
        assertNull(CanvasProtocol.decodeWebviewMessage("""{"type":"webview/unknown"}"""))
        assertNull(CanvasProtocol.decodeWebviewMessage("{}"))
    }

    @Test
    fun encodesHostStateAndEscapesText() {
        val json = CanvasProtocol.encodeHostMessage(
            HostMessageType.StateUpdated,
            CanvasHostState(
                nodes = listOf(
                    CanvasNoteNode(
                        id = "note-1",
                        title = "Quoted \"title\"",
                        body = "line 1\nline 2",
                        x = 12.5,
                        y = 42.0
                    )
                )
            )
        )

        assertContains(json, "\"type\": \"host/stateUpdated\"")
        assertContains(json, "\"title\": \"Quoted \\\"title\\\"\"")
        assertContains(json, "\"body\": \"line 1\\nline 2\"")
        assertContains(json, "\"x\": 12.5")
        assertContains(json, "\"y\": 42.0")
    }
}
