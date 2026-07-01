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
        val createTerminal = CanvasProtocol.decodeWebviewMessage("""{"type":"webview/createTerminal"}""")

        assertEquals(WebviewMessageType.Ready, ready?.type)
        assertEquals(WebviewMessageType.CreateNote, createNote?.type)
        assertEquals(WebviewMessageType.CreateTerminal, createTerminal?.type)
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
    fun decodesTerminalMessages() {
        val input = CanvasProtocol.decodeWebviewMessage(
            """{"type":"webview/terminalInput","id":"terminal-1","text":"echo hi\r"}"""
        )
        val resize = CanvasProtocol.decodeWebviewMessage(
            """{"type":"webview/terminalResize","id":"terminal-1","cols":120,"rows":32}"""
        )
        val size = CanvasProtocol.decodeWebviewMessage(
            """{"type":"webview/updateTerminalSize","id":"terminal-1","width":640,"height":360}"""
        )
        val stop = CanvasProtocol.decodeWebviewMessage(
            """{"type":"webview/stopTerminal","id":"terminal-1"}"""
        )

        assertEquals(WebviewMessageType.TerminalInput, input?.type)
        assertEquals("terminal-1", input?.terminalInput?.id)
        assertEquals("echo hi\r", input?.terminalInput?.text)
        assertEquals(WebviewMessageType.TerminalResize, resize?.type)
        assertEquals(120, resize?.terminalResize?.cols)
        assertEquals(32, resize?.terminalResize?.rows)
        assertEquals(WebviewMessageType.UpdateTerminalSize, size?.type)
        assertEquals(640.0, size?.terminalSize?.width)
        assertEquals(360.0, size?.terminalSize?.height)
        assertEquals(WebviewMessageType.StopTerminal, stop?.type)
        assertEquals("terminal-1", stop?.nodeId)
    }

    @Test
    fun rejectsUnknownWebviewMessages() {
        assertNull(CanvasProtocol.decodeWebviewMessage("""{"type":"webview/unknown"}"""))
        assertNull(CanvasProtocol.decodeWebviewMessage("{}"))
        assertNull(CanvasProtocol.decodeWebviewMessage("""{"type":"webview/updateNodePosition","id":"note-1","x":12.5}"""))
        assertNull(CanvasProtocol.decodeWebviewMessage("""{"type":"webview/deleteNode"}"""))
        assertNull(CanvasProtocol.decodeWebviewMessage("""{"type":"webview/terminalResize","id":"terminal-1","cols":80}"""))
    }

    @Test
    fun encodesHostStateAndEscapesText() {
        val json = CanvasProtocol.encodeHostMessage(
            HostMessageType.StateUpdated,
            CanvasHostState(
                nodes = listOf(
                    CanvasNode(
                        id = "note-1",
                        type = "note",
                        title = "Quoted \"title\"",
                        body = "line 1\nline 2",
                        x = 12.5,
                        y = 42.0,
                        width = 320.0,
                        height = 210.0
                    ),
                    CanvasNode(
                        id = "terminal-1",
                        type = "terminal",
                        title = "Terminal",
                        x = 100.0,
                        y = 240.0,
                        width = 560.0,
                        height = 320.0,
                        status = "running",
                        cwd = "/tmp/project",
                        shellPath = "/bin/bash",
                        recentOutput = "hello\n",
                        lastCols = 100,
                        lastRows = 30
                    )
                ),
                viewport = CanvasViewport(x = -100.0, y = 24.0, zoom = 1.25)
            )
        )

        assertContains(json, "\"type\": \"host/stateUpdated\"")
        assertContains(json, "\"type\": \"note\"")
        assertContains(json, "\"type\": \"terminal\"")
        assertContains(json, "\"title\": \"Quoted \\\"title\\\"\"")
        assertContains(json, "\"body\": \"line 1\\nline 2\"")
        assertContains(json, "\"status\": \"running\"")
        assertContains(json, "\"shellPath\": \"/bin/bash\"")
        assertContains(json, "\"lastCols\": 100")
        assertContains(json, "\"lastRows\": 30")
        assertContains(json, "\"viewport\"")
        assertContains(json, "\"zoom\": 1.25")
    }

    @Test
    fun encodesTerminalOutputAndExitMessages() {
        val output = CanvasProtocol.encodeTerminalOutput(TerminalOutputPayload(id = "terminal-1", text = "line 1\n"))
        val exit = CanvasProtocol.encodeTerminalExit(
            TerminalExitPayload(id = "terminal-1", status = "closed", exitCode = 0, message = "done")
        )

        assertContains(output, "\"type\": \"host/terminalOutput\"")
        assertContains(output, "\"text\": \"line 1\\n\"")
        assertContains(exit, "\"type\": \"host/terminalExit\"")
        assertContains(exit, "\"exitCode\": 0")
        assertContains(exit, "\"message\": \"done\"")
    }
}
