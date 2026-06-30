package com.devsessioncanvas.intellij.state

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
    }
}

data class CanvasProjectState(
    var schemaVersion: Int = 1
)
