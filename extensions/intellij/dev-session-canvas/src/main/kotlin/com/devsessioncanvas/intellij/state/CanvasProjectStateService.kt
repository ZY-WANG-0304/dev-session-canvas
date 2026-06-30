package com.devsessioncanvas.intellij.state

import com.devsessioncanvas.intellij.protocol.CanvasHostState
import com.devsessioncanvas.intellij.protocol.CanvasNoteNode
import com.devsessioncanvas.intellij.protocol.CanvasViewport
import com.devsessioncanvas.intellij.protocol.WebviewUpdateNotePayload
import com.devsessioncanvas.intellij.protocol.WebviewUpdateNodePositionPayload
import com.intellij.openapi.components.PersistentStateComponent
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.State
import com.intellij.openapi.components.Storage

@Service(Service.Level.PROJECT)
@State(name = "DevSessionCanvasState", storages = [Storage("devSessionCanvas.xml")])
class CanvasProjectStateService : PersistentStateComponent<CanvasProjectState> {
    private var state = CanvasProjectState()

    override fun getState(): CanvasProjectState = state

    override fun loadState(state: CanvasProjectState) {
        this.state = state
        normalizeLoadedState()
    }

    @Synchronized
    fun snapshot(): CanvasHostState {
        return CanvasHostState(
            nodes = state.notes.map { it.toProtocolNode() },
            viewport = state.viewport.toProtocolViewport()
        )
    }

    @Synchronized
    fun createNote(projectName: String): CanvasHostState {
        val noteNumber = state.nextNoteNumber
        state.nextNoteNumber += 1
        val note = CanvasPersistedNoteNode(
            id = "intellij-note-$noteNumber",
            title = "IntelliJ Note $noteNumber",
            body = "Persisted inside $projectName through the IntelliJ project service.",
            x = 80.0 + (noteNumber - 1) * 260.0,
            y = 80.0,
            width = DEFAULT_NOTE_WIDTH,
            height = DEFAULT_NOTE_HEIGHT
        )
        state.notes.add(note)
        return snapshot()
    }

    @Synchronized
    fun updateNote(payload: WebviewUpdateNotePayload): CanvasHostState {
        val note = state.notes.firstOrNull { it.id == payload.id } ?: return snapshot()
        payload.title?.let { note.title = it }
        payload.body?.let { note.body = it }
        payload.width?.takeIf { it.isFinite() }?.let { note.width = it }
        payload.height?.takeIf { it.isFinite() }?.let { note.height = it }
        return snapshot()
    }

    @Synchronized
    fun updateNodePosition(payload: WebviewUpdateNodePositionPayload): CanvasHostState {
        val note = state.notes.firstOrNull { it.id == payload.id } ?: return snapshot()
        if (payload.x.isFinite() && payload.y.isFinite()) {
            note.x = payload.x
            note.y = payload.y
        }
        return snapshot()
    }

    @Synchronized
    fun deleteNode(id: String): CanvasHostState {
        state.notes.removeIf { it.id == id }
        return snapshot()
    }

    @Synchronized
    fun updateViewport(viewport: CanvasViewport): CanvasHostState {
        if (viewport.x.isFinite() && viewport.y.isFinite() && viewport.zoom.isFinite()) {
            state.viewport = CanvasPersistedViewport(
                x = viewport.x,
                y = viewport.y,
                zoom = viewport.zoom.coerceIn(MIN_VIEWPORT_ZOOM, MAX_VIEWPORT_ZOOM)
            )
        }
        return snapshot()
    }

    companion object {
        private const val DEFAULT_NOTE_WIDTH = 260.0
        private const val DEFAULT_NOTE_HEIGHT = 180.0
        private const val MIN_VIEWPORT_ZOOM = 0.1
        private const val MAX_VIEWPORT_ZOOM = 4.0
        private val noteIdPattern = Regex("""^intellij-note-(\d+)$""")
    }

    private fun normalizeLoadedState() {
        val nextFromExistingNotes = state.notes
            .mapNotNull { noteIdPattern.matchEntire(it.id)?.groupValues?.getOrNull(1)?.toIntOrNull() }
            .maxOrNull()
            ?.plus(1)
            ?: 1
        state.nextNoteNumber = maxOf(state.nextNoteNumber, nextFromExistingNotes, 1)
    }
}

data class CanvasProjectState(
    var schemaVersion: Int = 1,
    var nextNoteNumber: Int = 1,
    var viewport: CanvasPersistedViewport = CanvasPersistedViewport(),
    var notes: MutableList<CanvasPersistedNoteNode> = mutableListOf()
)

data class CanvasPersistedViewport(
    var x: Double = 0.0,
    var y: Double = 0.0,
    var zoom: Double = 1.0
)

data class CanvasPersistedNoteNode(
    var id: String = "",
    var type: String = "note",
    var title: String = "",
    var body: String = "",
    var x: Double = 0.0,
    var y: Double = 0.0,
    var width: Double = 260.0,
    var height: Double = 180.0
)

private fun CanvasPersistedNoteNode.toProtocolNode(): CanvasNoteNode {
    return CanvasNoteNode(
        id = id,
        type = type,
        title = title,
        body = body,
        x = x,
        y = y,
        width = width,
        height = height
    )
}

private fun CanvasPersistedViewport.toProtocolViewport(): CanvasViewport {
    return CanvasViewport(x = x, y = y, zoom = zoom)
}
