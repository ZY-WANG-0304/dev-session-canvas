package com.devsessioncanvas.intellij.state

import com.devsessioncanvas.intellij.protocol.CanvasHostState
import com.devsessioncanvas.intellij.protocol.CanvasNode
import com.devsessioncanvas.intellij.protocol.CanvasViewport
import com.devsessioncanvas.intellij.protocol.WebviewTerminalSizePayload
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
            nodes = state.notes.map { it.toProtocolNode() } + state.terminals.map { it.toProtocolNode() },
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
    fun createTerminal(cwd: String, shellPath: String): CanvasTerminalCreation {
        val terminalNumber = state.nextTerminalNumber
        state.nextTerminalNumber += 1
        val terminal = CanvasPersistedTerminalNode(
            id = "intellij-terminal-$terminalNumber",
            title = "IntelliJ Terminal $terminalNumber",
            x = 80.0 + (terminalNumber - 1) * 320.0,
            y = 320.0,
            width = DEFAULT_TERMINAL_WIDTH,
            height = DEFAULT_TERMINAL_HEIGHT,
            status = "starting",
            cwd = cwd,
            shellPath = shellPath,
            lastCols = DEFAULT_TERMINAL_COLS,
            lastRows = DEFAULT_TERMINAL_ROWS
        )
        state.terminals.add(terminal)
        return CanvasTerminalCreation(state = snapshot(), terminal = terminal.copy())
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
        if (!payload.x.isFinite() || !payload.y.isFinite()) {
            return snapshot()
        }
        val note = state.notes.firstOrNull { it.id == payload.id }
        if (note != null) {
            note.x = payload.x
            note.y = payload.y
            return snapshot()
        }
        val terminal = state.terminals.firstOrNull { it.id == payload.id }
        if (terminal != null) {
            terminal.x = payload.x
            terminal.y = payload.y
        }
        return snapshot()
    }

    @Synchronized
    fun deleteNode(id: String): CanvasHostState {
        state.notes.removeIf { it.id == id }
        state.terminals.removeIf { it.id == id }
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

    @Synchronized
    fun updateTerminalStatus(id: String, status: String, message: String = ""): CanvasHostState {
        val terminal = state.terminals.firstOrNull { it.id == id } ?: return snapshot()
        terminal.status = status
        if (message.isNotBlank()) {
            terminal.recentOutput = trimStoredTerminalText("${terminal.recentOutput}\n$message\n")
        }
        return snapshot()
    }

    @Synchronized
    fun appendTerminalOutput(id: String, text: String): CanvasHostState {
        val terminal = state.terminals.firstOrNull { it.id == id } ?: return snapshot()
        terminal.recentOutput = trimStoredTerminalText(terminal.recentOutput + text)
        if (terminal.status == "starting") {
            terminal.status = "running"
        }
        return snapshot()
    }

    @Synchronized
    fun updateTerminalPtySize(id: String, cols: Int, rows: Int): CanvasHostState {
        val terminal = state.terminals.firstOrNull { it.id == id } ?: return snapshot()
        terminal.lastCols = normalizeTerminalCols(cols)
        terminal.lastRows = normalizeTerminalRows(rows)
        return snapshot()
    }

    @Synchronized
    fun updateTerminalSize(payload: WebviewTerminalSizePayload): CanvasHostState {
        val terminal = state.terminals.firstOrNull { it.id == payload.id } ?: return snapshot()
        if (payload.width.isFinite() && payload.height.isFinite()) {
            terminal.width = payload.width.coerceAtLeast(MIN_TERMINAL_WIDTH)
            terminal.height = payload.height.coerceAtLeast(MIN_TERMINAL_HEIGHT)
        }
        return snapshot()
    }

    @Synchronized
    fun isTerminalNode(id: String): Boolean = state.terminals.any { it.id == id }

    companion object {
        private const val DEFAULT_NOTE_WIDTH = 260.0
        private const val DEFAULT_NOTE_HEIGHT = 180.0
        private const val DEFAULT_TERMINAL_WIDTH = 560.0
        private const val DEFAULT_TERMINAL_HEIGHT = 320.0
        private const val MIN_TERMINAL_WIDTH = 320.0
        private const val MIN_TERMINAL_HEIGHT = 220.0
        private const val DEFAULT_TERMINAL_COLS = 80
        private const val DEFAULT_TERMINAL_ROWS = 24
        private const val MIN_TERMINAL_COLS = 20
        private const val MAX_TERMINAL_COLS = 240
        private const val MIN_TERMINAL_ROWS = 4
        private const val MAX_TERMINAL_ROWS = 80
        private const val MAX_TERMINAL_RECENT_OUTPUT = 12000
        private const val MIN_VIEWPORT_ZOOM = 0.1
        private const val MAX_VIEWPORT_ZOOM = 4.0
        private val noteIdPattern = Regex("""^intellij-note-(\d+)$""")
        private val terminalIdPattern = Regex("""^intellij-terminal-(\d+)$""")

        fun normalizeTerminalCols(cols: Int): Int = cols.coerceIn(MIN_TERMINAL_COLS, MAX_TERMINAL_COLS)

        fun normalizeTerminalRows(rows: Int): Int = rows.coerceIn(MIN_TERMINAL_ROWS, MAX_TERMINAL_ROWS)
    }

    private fun normalizeLoadedState() {
        val nextFromExistingNotes = state.notes
            .mapNotNull { noteIdPattern.matchEntire(it.id)?.groupValues?.getOrNull(1)?.toIntOrNull() }
            .maxOrNull()
            ?.plus(1)
            ?: 1
        state.nextNoteNumber = maxOf(state.nextNoteNumber, nextFromExistingNotes, 1)

        val nextFromExistingTerminals = state.terminals
            .mapNotNull { terminalIdPattern.matchEntire(it.id)?.groupValues?.getOrNull(1)?.toIntOrNull() }
            .maxOrNull()
            ?.plus(1)
            ?: 1
        state.nextTerminalNumber = maxOf(state.nextTerminalNumber, nextFromExistingTerminals, 1)
        state.terminals.forEach { terminal ->
            terminal.lastCols = normalizeTerminalCols(terminal.lastCols)
            terminal.lastRows = normalizeTerminalRows(terminal.lastRows)
            terminal.recentOutput = trimStoredTerminalText(terminal.recentOutput)
        }
    }

    private fun trimStoredTerminalText(value: String): String {
        return if (value.length <= MAX_TERMINAL_RECENT_OUTPUT) {
            value
        } else {
            value.takeLast(MAX_TERMINAL_RECENT_OUTPUT)
        }
    }
}

data class CanvasTerminalCreation(
    val state: CanvasHostState,
    val terminal: CanvasPersistedTerminalNode
)

data class CanvasProjectState(
    var schemaVersion: Int = 1,
    var nextNoteNumber: Int = 1,
    var nextTerminalNumber: Int = 1,
    var viewport: CanvasPersistedViewport = CanvasPersistedViewport(),
    var notes: MutableList<CanvasPersistedNoteNode> = mutableListOf(),
    var terminals: MutableList<CanvasPersistedTerminalNode> = mutableListOf()
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

data class CanvasPersistedTerminalNode(
    var id: String = "",
    var type: String = "terminal",
    var title: String = "",
    var x: Double = 0.0,
    var y: Double = 0.0,
    var width: Double = 560.0,
    var height: Double = 320.0,
    var status: String = "idle",
    var cwd: String = "",
    var shellPath: String = "",
    var recentOutput: String = "",
    var lastCols: Int = 80,
    var lastRows: Int = 24
)

private fun CanvasPersistedNoteNode.toProtocolNode(): CanvasNode {
    return CanvasNode(
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

private fun CanvasPersistedTerminalNode.toProtocolNode(): CanvasNode {
    return CanvasNode(
        id = id,
        type = type,
        title = title,
        x = x,
        y = y,
        width = width,
        height = height,
        status = status,
        cwd = cwd,
        shellPath = shellPath,
        recentOutput = recentOutput,
        lastCols = lastCols,
        lastRows = lastRows
    )
}

private fun CanvasPersistedViewport.toProtocolViewport(): CanvasViewport {
    return CanvasViewport(x = x, y = y, zoom = zoom)
}
