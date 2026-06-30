package com.devsessioncanvas.intellij.state

import com.devsessioncanvas.intellij.protocol.CanvasViewport
import com.devsessioncanvas.intellij.protocol.WebviewUpdateNotePayload
import com.devsessioncanvas.intellij.protocol.WebviewUpdateNodePositionPayload
import kotlin.test.Test
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
    fun deletesNodeFromPersistedSnapshot() {
        val service = CanvasProjectStateService()
        val firstId = service.createNote("SampleProject").nodes.single().id
        service.createNote("SampleProject")

        val snapshot = service.deleteNode(firstId)

        assertEquals(listOf("intellij-note-2"), snapshot.nodes.map { it.id })
        assertEquals(listOf("intellij-note-2"), service.getState().notes.map { it.id })
    }
}
