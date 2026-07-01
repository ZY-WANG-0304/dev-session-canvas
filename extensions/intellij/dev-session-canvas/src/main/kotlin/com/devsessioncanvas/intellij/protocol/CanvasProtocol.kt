package com.devsessioncanvas.intellij.protocol

enum class WebviewMessageType(val wireName: String) {
    Ready("webview/ready"),
    CreateNote("webview/createNote"),
    CreateTerminal("webview/createTerminal"),
    UpdateNote("webview/updateNote"),
    UpdateNodePosition("webview/updateNodePosition"),
    UpdateViewport("webview/updateViewport"),
    DeleteNode("webview/deleteNode"),
    TerminalInput("webview/terminalInput"),
    TerminalResize("webview/terminalResize"),
    UpdateTerminalSize("webview/updateTerminalSize"),
    StopTerminal("webview/stopTerminal")
}

data class WebviewMessage(
    val type: WebviewMessageType,
    val nodeId: String? = null,
    val updateNote: WebviewUpdateNotePayload? = null,
    val updateNodePosition: WebviewUpdateNodePositionPayload? = null,
    val updateViewport: CanvasViewport? = null,
    val terminalInput: WebviewTerminalInputPayload? = null,
    val terminalResize: WebviewTerminalResizePayload? = null,
    val terminalSize: WebviewTerminalSizePayload? = null
)

data class WebviewUpdateNotePayload(
    val id: String,
    val title: String? = null,
    val body: String? = null,
    val width: Double? = null,
    val height: Double? = null
)

data class WebviewUpdateNodePositionPayload(
    val id: String,
    val x: Double,
    val y: Double
)

data class WebviewTerminalInputPayload(
    val id: String,
    val text: String
)

data class WebviewTerminalResizePayload(
    val id: String,
    val cols: Int,
    val rows: Int
)

data class WebviewTerminalSizePayload(
    val id: String,
    val width: Double,
    val height: Double
)

enum class HostMessageType(val wireName: String) {
    Bootstrap("host/bootstrap"),
    StateUpdated("host/stateUpdated"),
    TerminalOutput("host/terminalOutput"),
    TerminalExit("host/terminalExit")
}

data class CanvasHostState(
    val nodes: List<CanvasNode> = emptyList(),
    val viewport: CanvasViewport = CanvasViewport()
)

data class CanvasNode(
    val id: String,
    val type: String,
    val title: String,
    val x: Double,
    val y: Double,
    val width: Double,
    val height: Double,
    val body: String = "",
    val status: String = "idle",
    val cwd: String = "",
    val shellPath: String = "",
    val recentOutput: String = "",
    val lastCols: Int = 80,
    val lastRows: Int = 24
)

data class CanvasViewport(
    val x: Double = 0.0,
    val y: Double = 0.0,
    val zoom: Double = 1.0
)

data class TerminalOutputPayload(
    val id: String,
    val text: String
)

data class TerminalExitPayload(
    val id: String,
    val status: String,
    val exitCode: Int? = null,
    val message: String = ""
)

object CanvasProtocol {
    private val typePattern = Regex(""""type"\s*:\s*"([^"]+)"""")

    fun decodeWebviewMessage(rawJson: String): WebviewMessage? {
        val wireType = typePattern.find(rawJson)?.groupValues?.getOrNull(1) ?: return null
        return when (wireType) {
            WebviewMessageType.Ready.wireName -> WebviewMessage(WebviewMessageType.Ready)
            WebviewMessageType.CreateNote.wireName,
            "webview/createTestNote" -> WebviewMessage(WebviewMessageType.CreateNote)
            WebviewMessageType.CreateTerminal.wireName -> WebviewMessage(WebviewMessageType.CreateTerminal)
            WebviewMessageType.UpdateNote.wireName -> decodeUpdateNote(rawJson)
            WebviewMessageType.UpdateNodePosition.wireName -> decodeUpdateNodePosition(rawJson)
            WebviewMessageType.UpdateViewport.wireName -> decodeUpdateViewport(rawJson)
            WebviewMessageType.DeleteNode.wireName -> decodeDeleteNode(rawJson)
            WebviewMessageType.TerminalInput.wireName -> decodeTerminalInput(rawJson)
            WebviewMessageType.TerminalResize.wireName -> decodeTerminalResize(rawJson)
            WebviewMessageType.UpdateTerminalSize.wireName -> decodeTerminalSize(rawJson)
            WebviewMessageType.StopTerminal.wireName -> decodeStopTerminal(rawJson)
            else -> null
        }
    }

    fun encodeHostMessage(type: HostMessageType, state: CanvasHostState): String {
        return """
            {
              "type": ${jsonText(type.wireName)},
              "payload": ${encodeHostState(state)}
            }
        """.trimIndent()
    }

    fun encodeTerminalOutput(payload: TerminalOutputPayload): String {
        return """
            {
              "type": ${jsonText(HostMessageType.TerminalOutput.wireName)},
              "payload": {
                "id": ${jsonText(payload.id)},
                "text": ${jsonText(payload.text)}
              }
            }
        """.trimIndent()
    }

    fun encodeTerminalExit(payload: TerminalExitPayload): String {
        val exitCode = payload.exitCode?.toString() ?: "null"
        return """
            {
              "type": ${jsonText(HostMessageType.TerminalExit.wireName)},
              "payload": {
                "id": ${jsonText(payload.id)},
                "status": ${jsonText(payload.status)},
                "exitCode": $exitCode,
                "message": ${jsonText(payload.message)}
              }
            }
        """.trimIndent()
    }

    private fun encodeHostState(state: CanvasHostState): String {
        return """
            {
              "nodes": [${state.nodes.joinToString(",") { encodeNode(it) }}],
              "viewport": ${encodeViewport(state.viewport)}
            }
        """.trimIndent()
    }

    private fun encodeNode(node: CanvasNode): String {
        return """
            {
              "id": ${jsonText(node.id)},
              "type": ${jsonText(node.type)},
              "title": ${jsonText(node.title)},
              "body": ${jsonText(node.body)},
              "x": ${node.x},
              "y": ${node.y},
              "width": ${node.width},
              "height": ${node.height},
              "status": ${jsonText(node.status)},
              "cwd": ${jsonText(node.cwd)},
              "shellPath": ${jsonText(node.shellPath)},
              "recentOutput": ${jsonText(node.recentOutput)},
              "lastCols": ${node.lastCols},
              "lastRows": ${node.lastRows}
            }
        """.trimIndent()
    }

    private fun encodeViewport(viewport: CanvasViewport): String {
        return """
            {
              "x": ${viewport.x},
              "y": ${viewport.y},
              "zoom": ${viewport.zoom}
            }
        """.trimIndent()
    }

    private fun decodeUpdateNote(rawJson: String): WebviewMessage? {
        val id = stringProperty(rawJson, "id") ?: return null
        return WebviewMessage(
            type = WebviewMessageType.UpdateNote,
            updateNote = WebviewUpdateNotePayload(
                id = id,
                title = stringProperty(rawJson, "title"),
                body = stringProperty(rawJson, "body"),
                width = numberProperty(rawJson, "width"),
                height = numberProperty(rawJson, "height")
            )
        )
    }

    private fun decodeUpdateNodePosition(rawJson: String): WebviewMessage? {
        val id = stringProperty(rawJson, "id") ?: return null
        val x = numberProperty(rawJson, "x") ?: return null
        val y = numberProperty(rawJson, "y") ?: return null
        return WebviewMessage(
            type = WebviewMessageType.UpdateNodePosition,
            updateNodePosition = WebviewUpdateNodePositionPayload(id = id, x = x, y = y)
        )
    }

    private fun decodeUpdateViewport(rawJson: String): WebviewMessage? {
        val x = numberProperty(rawJson, "x") ?: return null
        val y = numberProperty(rawJson, "y") ?: return null
        val zoom = numberProperty(rawJson, "zoom") ?: return null
        return WebviewMessage(
            type = WebviewMessageType.UpdateViewport,
            updateViewport = CanvasViewport(x = x, y = y, zoom = zoom)
        )
    }

    private fun decodeDeleteNode(rawJson: String): WebviewMessage? {
        val id = stringProperty(rawJson, "id") ?: return null
        return WebviewMessage(type = WebviewMessageType.DeleteNode, nodeId = id)
    }

    private fun decodeTerminalInput(rawJson: String): WebviewMessage? {
        val id = stringProperty(rawJson, "id") ?: return null
        val text = stringProperty(rawJson, "text") ?: return null
        return WebviewMessage(
            type = WebviewMessageType.TerminalInput,
            terminalInput = WebviewTerminalInputPayload(id = id, text = text)
        )
    }

    private fun decodeTerminalResize(rawJson: String): WebviewMessage? {
        val id = stringProperty(rawJson, "id") ?: return null
        val cols = intProperty(rawJson, "cols") ?: return null
        val rows = intProperty(rawJson, "rows") ?: return null
        return WebviewMessage(
            type = WebviewMessageType.TerminalResize,
            terminalResize = WebviewTerminalResizePayload(id = id, cols = cols, rows = rows)
        )
    }

    private fun decodeTerminalSize(rawJson: String): WebviewMessage? {
        val id = stringProperty(rawJson, "id") ?: return null
        val width = numberProperty(rawJson, "width") ?: return null
        val height = numberProperty(rawJson, "height") ?: return null
        return WebviewMessage(
            type = WebviewMessageType.UpdateTerminalSize,
            terminalSize = WebviewTerminalSizePayload(id = id, width = width, height = height)
        )
    }

    private fun decodeStopTerminal(rawJson: String): WebviewMessage? {
        val id = stringProperty(rawJson, "id") ?: return null
        return WebviewMessage(type = WebviewMessageType.StopTerminal, nodeId = id)
    }

    private fun stringProperty(rawJson: String, propertyName: String): String? {
        val pattern = Regex(""""${Regex.escape(propertyName)}"\s*:\s*"((?:\\.|[^"\\])*)"""")
        return pattern.find(rawJson)?.groupValues?.getOrNull(1)?.let(::unescapeJsonText)
    }

    private fun numberProperty(rawJson: String, propertyName: String): Double? {
        val pattern = Regex(""""${Regex.escape(propertyName)}"\s*:\s*(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)""")
        return pattern.find(rawJson)?.groupValues?.getOrNull(1)?.toDoubleOrNull()
    }

    private fun intProperty(rawJson: String, propertyName: String): Int? {
        return numberProperty(rawJson, propertyName)?.toInt()
    }

    private fun unescapeJsonText(value: String): String {
        return buildString {
            var index = 0
            while (index < value.length) {
                val char = value[index]
                if (char != '\\' || index == value.lastIndex) {
                    append(char)
                    index += 1
                    continue
                }

                when (val escaped = value[index + 1]) {
                    '"', '\\', '/' -> append(escaped)
                    'b' -> append('\b')
                    'f' -> append('\u000C')
                    'n' -> append('\n')
                    'r' -> append('\r')
                    't' -> append('\t')
                    'u' -> {
                        val hex = value.substringOrNull(index + 2, index + 6)
                        if (hex != null) {
                            hex.toIntOrNull(16)?.toChar()?.let(::append)
                        }
                        index += 4
                    }
                    else -> append(escaped)
                }
                index += 2
            }
        }
    }

    private fun String.substringOrNull(startIndex: Int, endIndex: Int): String? {
        return if (startIndex >= 0 && endIndex <= length && startIndex < endIndex) {
            substring(startIndex, endIndex)
        } else {
            null
        }
    }

    fun jsonText(value: String): String {
        return buildString {
            append('"')
            value.forEach { char ->
                when (char) {
                    '\\' -> append("\\\\")
                    '"' -> append("\\\"")
                    '\n' -> append("\\n")
                    '\r' -> append("\\r")
                    '\t' -> append("\\t")
                    else -> {
                        if (char.code < 0x20) {
                            append("\\u")
                            append(char.code.toString(16).padStart(4, '0'))
                        } else {
                            append(char)
                        }
                    }
                }
            }
            append('"')
        }
    }
}
