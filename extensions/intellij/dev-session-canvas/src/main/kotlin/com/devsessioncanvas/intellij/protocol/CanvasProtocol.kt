package com.devsessioncanvas.intellij.protocol

enum class WebviewMessageType(val wireName: String) {
    Ready("webview/ready"),
    CreateNote("webview/createNote")
}

data class WebviewMessage(val type: WebviewMessageType)

enum class HostMessageType(val wireName: String) {
    Bootstrap("host/bootstrap"),
    StateUpdated("host/stateUpdated")
}

data class CanvasHostState(
    val nodes: List<CanvasNoteNode> = emptyList()
)

data class CanvasNoteNode(
    val id: String,
    val title: String,
    val body: String,
    val x: Double,
    val y: Double
)

object CanvasProtocol {
    private val typePattern = Regex(""""type"\s*:\s*"([^"]+)"""")

    fun decodeWebviewMessage(rawJson: String): WebviewMessage? {
        val wireType = typePattern.find(rawJson)?.groupValues?.getOrNull(1) ?: return null
        val type = when (wireType) {
            WebviewMessageType.Ready.wireName -> WebviewMessageType.Ready
            WebviewMessageType.CreateNote.wireName,
            "webview/createTestNote" -> WebviewMessageType.CreateNote
            else -> return null
        }
        return WebviewMessage(type)
    }

    fun encodeHostMessage(type: HostMessageType, state: CanvasHostState): String {
        return """
            {
              "type": ${jsonText(type.wireName)},
              "payload": {
                "nodes": [${state.nodes.joinToString(",") { encodeNode(it) }}]
              }
            }
        """.trimIndent()
    }

    private fun encodeNode(node: CanvasNoteNode): String {
        return """
            {
              "id": ${jsonText(node.id)},
              "title": ${jsonText(node.title)},
              "body": ${jsonText(node.body)},
              "x": ${node.x},
              "y": ${node.y}
            }
        """.trimIndent()
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
                    else -> append(char)
                }
            }
            append('"')
        }
    }
}
