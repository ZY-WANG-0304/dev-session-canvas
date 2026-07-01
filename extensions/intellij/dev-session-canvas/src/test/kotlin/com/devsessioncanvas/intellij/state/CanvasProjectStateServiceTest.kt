package com.devsessioncanvas.intellij.state

import com.devsessioncanvas.intellij.protocol.CanvasViewport
import com.devsessioncanvas.intellij.protocol.WebviewTerminalSizePayload
import com.devsessioncanvas.intellij.protocol.WebviewUpdateNotePayload
import com.devsessioncanvas.intellij.protocol.WebviewUpdateNodePositionPayload
import kotlin.test.Test
import kotlin.test.assertContains
import kotlin.test.assertEquals

class CanvasProjectStateServiceTest {
    @Test
    fun createsNotesAndExposesSnapshot() {
        val service = CanvasProjectStateService()

        val first = service.createNote("SampleProject")
        val second = service.createNote("SampleProject")

        assertEquals(listOf("intellij-note-1"), first.nodes.map { it.id })
        assertEquals(listOf("intellij-note-1", "intellij-note-2"), second.nodes.map { it.id })
        assertEquals(80.0, second.nodes[0].x)
        assertEquals(340.0, second.nodes[1].x)
        assertEquals(3, service.getState().nextNoteNumber)
    }

    @Test
    fun updatesNotePositionSizeAndViewport() {
        val service = CanvasProjectStateService()
        val noteId = service.createNote("SampleProject").nodes.single().id

        service.updateNote(
            WebviewUpdateNotePayload(
                id = noteId,
                title = "Updated title",
                body = "Updated body",
                width = 340.0,
                height = 220.0
            )
        )
        service.updateNodePosition(WebviewUpdateNodePositionPayload(id = noteId, x = -12.5, y = 42.0))
        service.updateViewport(CanvasViewport(x = 10.0, y = 20.0, zoom = 5.5))

        val snapshot = service.snapshot()
        val note = snapshot.nodes.single()
        assertEquals("Updated title", note.title)
        assertEquals("Updated body", note.body)
        assertEquals(-12.5, note.x)
        assertEquals(42.0, note.y)
        assertEquals(340.0, note.width)
        assertEquals(220.0, note.height)
        assertEquals(10.0, snapshot.viewport.x)
        assertEquals(20.0, snapshot.viewport.y)
        assertEquals(4.0, snapshot.viewport.zoom)
    }

    @Test
    fun loadStateNormalizesNextNoteNumber() {
        val service = CanvasProjectStateService()
        service.loadState(
            CanvasProjectState(
                nextNoteNumber = 1,
                notes = mutableListOf(
                    CanvasPersistedNoteNode(id = "intellij-note-7", title = "Existing")
                )
            )
        )

        val snapshot = service.createNote("SampleProject")

        assertEquals(listOf("intellij-note-7", "intellij-note-8"), snapshot.nodes.map { it.id })
        assertEquals(9, service.getState().nextNoteNumber)
    }

    @Test
    fun createsTerminalsAndExposesSnapshot() {
        val service = CanvasProjectStateService()

        val creation = service.createTerminal(cwd = "/tmp/project", shellPath = "/bin/bash")
        val terminal = creation.state.nodes.single()

        assertEquals("intellij-terminal-1", creation.terminal.id)
        assertEquals("terminal", terminal.type)
        assertEquals("IntelliJ Terminal 1", terminal.title)
        assertEquals("starting", terminal.status)
        assertEquals("/tmp/project", terminal.cwd)
        assertEquals("/bin/bash", terminal.shellPath)
        assertEquals(80, terminal.lastCols)
        assertEquals(24, terminal.lastRows)
        assertEquals(2, service.getState().nextTerminalNumber)
    }

    @Test
    fun updatesTerminalOutputPositionSizeAndStatus() {
        val service = CanvasProjectStateService()
        val terminalId = service.createTerminal(cwd = "/tmp/project", shellPath = "/bin/bash").terminal.id

        service.appendTerminalOutput(terminalId, "hello\n")
        service.updateTerminalPtySize(terminalId, cols = 999, rows = 1)
        service.updateTerminalSize(WebviewTerminalSizePayload(id = terminalId, width = 120.0, height = 80.0))
        service.updateNodePosition(WebviewUpdateNodePositionPayload(id = terminalId, x = -24.0, y = 128.0))
        service.updateTerminalStatus(terminalId, status = "closed", message = "Terminal exited with code 0.")

        val terminal = service.snapshot().nodes.single()
        assertEquals("closed", terminal.status)
        assertEquals(-24.0, terminal.x)
        assertEquals(128.0, terminal.y)
        assertEquals(320.0, terminal.width)
        assertEquals(220.0, terminal.height)
        assertEquals(240, terminal.lastCols)
        assertEquals(4, terminal.lastRows)
        assertContains(terminal.recentOutput, "hello")
        assertContains(terminal.recentOutput, "Terminal exited with code 0.")
    }

    @Test
    fun loadStateNormalizesTerminalCountersAndBounds() {
        val service = CanvasProjectStateService()
        service.loadState(
            CanvasProjectState(
                nextTerminalNumber = 1,
                terminals = mutableListOf(
                    CanvasPersistedTerminalNode(
                        id = "intellij-terminal-7",
                        title = "Existing terminal",
                        lastCols = 1,
                        lastRows = 999,
                        recentOutput = "x".repeat(13_000)
                    )
                )
            )
        )

        val snapshot = service.createTerminal(cwd = "/tmp/project", shellPath = "/bin/sh").state
        val restored = snapshot.nodes.first()

        assertEquals(listOf("intellij-terminal-7", "intellij-terminal-8"), snapshot.nodes.map { it.id })
        assertEquals(9, service.getState().nextTerminalNumber)
        assertEquals(20, restored.lastCols)
        assertEquals(80, restored.lastRows)
        assertEquals(12_000, restored.recentOutput.length)
    }

    @Test
    fun deletesNodeFromPersistedSnapshot() {
        val service = CanvasProjectStateService()
        val firstId = service.createNote("SampleProject").nodes.single().id
        val terminalId = service.createTerminal(cwd = "/tmp/project", shellPath = "/bin/bash").terminal.id

        val noteDeleted = service.deleteNode(firstId)
        val terminalDeleted = service.deleteNode(terminalId)

        assertEquals(listOf("intellij-terminal-1"), noteDeleted.nodes.map { it.id })
        assertEquals(emptyList(), terminalDeleted.nodes.map { it.id })
        assertEquals(emptyList(), service.getState().notes.map { it.id })
        assertEquals(emptyList(), service.getState().terminals.map { it.id })
    }
}
