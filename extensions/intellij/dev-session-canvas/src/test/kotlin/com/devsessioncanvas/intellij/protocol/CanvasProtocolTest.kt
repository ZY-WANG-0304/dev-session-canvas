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

        assertEquals(WebviewMessageType.Ready, ready?.type)
        assertEquals(WebviewMessageType.CreateNote, createNote?.type)
    }

    @Test
    fun decodesNoteMutationMessages() {
        val updateNote = CanvasProtocol.decodeWebviewMessage(
            """{"type":"webview/updateNote","id":"note-1","title":"Quoted \"title\"","body":"line 1\nline 2","width":320,"height":210.5}"""
        )
        val updatePosition = CanvasProtocol.decodeWebviewMessage(
            """{"type":"webview/updateNodePosition","id":"note-1","x":12.5,"y":-24}"""
        )
        val updateViewport = CanvasProtocol.decodeWebviewMessage(
            """{"type":"webview/updateViewport","x":-120,"y":64.25,"zoom":1.5}"""
        )
        val deleteNode = CanvasProtocol.decodeWebviewMessage(
            """{"type":"webview/deleteNode","id":"note-1"}"""
        )

        assertEquals(WebviewMessageType.UpdateNote, updateNote?.type)
        assertEquals("note-1", updateNote?.updateNote?.id)
        assertEquals("Quoted \"title\"", updateNote?.updateNote?.title)
        assertEquals("line 1\nline 2", updateNote?.updateNote?.body)
        assertEquals(320.0, updateNote?.updateNote?.width)
        assertEquals(210.5, updateNote?.updateNote?.height)

        assertEquals(WebviewMessageType.UpdateNodePosition, updatePosition?.type)
        assertEquals("note-1", updatePosition?.updateNodePosition?.id)
        assertEquals(12.5, updatePosition?.updateNodePosition?.x)
        assertEquals(-24.0, updatePosition?.updateNodePosition?.y)

        assertEquals(WebviewMessageType.UpdateViewport, updateViewport?.type)
        assertEquals(-120.0, updateViewport?.updateViewport?.x)
        assertEquals(64.25, updateViewport?.updateViewport?.y)
        assertEquals(1.5, updateViewport?.updateViewport?.zoom)

        assertEquals(WebviewMessageType.DeleteNode, deleteNode?.type)
        assertEquals("note-1", deleteNode?.nodeId)
    }

    @Test
    fun rejectsUnknownWebviewMessages() {
        assertNull(CanvasProtocol.decodeWebviewMessage("""{"type":"webview/unknown"}"""))
        assertNull(CanvasProtocol.decodeWebviewMessage("{}"))
        assertNull(CanvasProtocol.decodeWebviewMessage("""{"type":"webview/updateNodePosition","id":"note-1","x":12.5}"""))
        assertNull(CanvasProtocol.decodeWebviewMessage("""{"type":"webview/deleteNode"}"""))
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
                        y = 42.0,
                        width = 320.0,
                        height = 210.0
                    )
                ),
                viewport = CanvasViewport(x = -100.0, y = 24.0, zoom = 1.25)
            )
        )

        assertContains(json, "\"type\": \"host/stateUpdated\"")
        assertContains(json, "\"type\": \"note\"")
        assertContains(json, "\"title\": \"Quoted \\\"title\\\"\"")
        assertContains(json, "\"body\": \"line 1\\nline 2\"")
        assertContains(json, "\"x\": 12.5")
        assertContains(json, "\"y\": 42.0")
        assertContains(json, "\"width\": 320.0")
        assertContains(json, "\"height\": 210.0")
        assertContains(json, "\"viewport\"")
        assertContains(json, "\"zoom\": 1.25")
    }
}
