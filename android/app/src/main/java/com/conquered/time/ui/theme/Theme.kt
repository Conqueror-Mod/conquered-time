package com.conquered.time.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

// A restrained palette echoing the desktop's default (Memoria) — cool silver
// with amethyst accents. Full FF theme parity is a later milestone.
private val Amethyst = Color(0xFF7C6BB0)
private val AmethystDark = Color(0xFFB6A6E6)

private val LightColors = lightColorScheme(
    primary = Amethyst,
    secondary = Color(0xFF5C6B8A),
)

private val DarkColors = darkColorScheme(
    primary = AmethystDark,
    secondary = Color(0xFF9AA7C2),
)

@Composable
fun ConqueredTimeTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    MaterialTheme(
        colorScheme = if (darkTheme) DarkColors else LightColors,
        content = content,
    )
}
