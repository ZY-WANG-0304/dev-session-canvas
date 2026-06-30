package com.devsessioncanvas.intellij.toolwindow

import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.project.Project
import com.intellij.ui.jcef.JBCefBrowser
import com.intellij.ui.jcef.JBCefBrowserBase
import com.intellij.ui.jcef.JBCefJSQuery

class CanvasBrowserBridge(
    private val project: Project,
    private val browser: JBCefBrowser
) : Disposable {
    private val query = JBCefJSQuery.create(browser as JBCefBrowserBase)
    private val notes = mutableListOf<TestNote>()

    init {
        query.addHandler { request ->
            handleWebviewMessage(request)
            null
        }
    }

    fun postMessageScript(argumentExpression: String): String = query.inject(argumentExpression)

    override fun dispose() {
        query.dispose()
    }

    private fun handleWebviewMessage(request: String) {
        when {
            request.contains("\"type\":\"webview/ready\"") -> sendBootstrap()
            request.contains("\"type\":\"webview/createTestNote\"") -> createTestNote()
        }
    }

    private fun sendBootstrap() {
        sendToWebview(hostMessage("host/bootstrap"))
    }

    private fun createTestNote() {
        val noteNumber = notes.size + 1
        notes += TestNote(
            id = "intellij-note-$noteNumber",
            title = "IntelliJ Test Note $noteNumber",
            body = "Created inside ${project.name} through the JCEF bridge.",
            x = 80.0 + (noteNumber - 1) * 260.0,
            y = 80.0
        )
        sendToWebview(hostMessage("host/stateUpdated"))
    }

    private fun hostMessage(type: String): String {
        return """
            {
              "type": ${jsonText(type)},
              "payload": {
                "nodes": [${notes.joinToString(",") { it.toJson() }}]
              }
            }
        """.trimIndent()
    }

    private fun sendToWebview(json: String) {
        ApplicationManager.getApplication().invokeLater {
            browser.cefBrowser.executeJavaScript(
                "window.devSessionCanvasReceiveHostMessage && window.devSessionCanvasReceiveHostMessage($json);",
                browser.cefBrowser.url,
                0
            )
        }
    }

    private data class TestNote(
        val id: String,
        val title: String,
        val body: String,
        val x: Double,
        val y: Double
    ) {
        fun toJson(): String {
            return """
                {
                  "id": ${jsonText(id)},
                  "title": ${jsonText(title)},
                  "body": ${jsonText(body)},
                  "x": $x,
                  "y": $y
                }
            """.trimIndent()
        }
    }
}

private fun jsonText(value: String): String {
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
