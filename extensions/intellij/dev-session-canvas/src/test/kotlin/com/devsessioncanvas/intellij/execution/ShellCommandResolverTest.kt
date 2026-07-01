package com.devsessioncanvas.intellij.execution

import kotlin.test.Test
import kotlin.test.assertContains
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class ShellCommandResolverTest {
    @Test
    fun usesConfiguredPosixShell() {
        val shell = ShellCommandResolver.defaultShellPath(
            environment = mapOf("SHELL" to "/custom/shell"),
            osName = "Linux"
        )

        assertEquals("/custom/shell", shell)
    }

    @Test
    fun fallsBackToKnownPosixShell() {
        val shell = ShellCommandResolver.defaultShellPath(environment = emptyMap(), osName = "Linux")

        assertContains(listOf("/bin/zsh", "/bin/bash", "/bin/sh"), shell)
    }

    @Test
    fun resolvesWindowsShellWithoutPosixShell() {
        val shell = ShellCommandResolver.defaultShellPath(environment = emptyMap(), osName = "Windows 11")

        assertTrue(shell.endsWith("powershell.exe", ignoreCase = true) || shell.endsWith("cmd.exe", ignoreCase = true))
    }

    @Test
    fun usesProjectBasePathAsWorkingDirectory() {
        assertEquals("/tmp/project", ShellCommandResolver.defaultWorkingDirectory("/tmp/project"))
    }
}
