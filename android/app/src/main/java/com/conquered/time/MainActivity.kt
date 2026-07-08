package com.conquered.time

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.lifecycle.viewmodel.compose.viewModel
import com.conquered.time.ui.BrowseScreen
import com.conquered.time.ui.ImportScreen
import com.conquered.time.ui.UnlockScreen
import com.conquered.time.ui.VaultScreen
import com.conquered.time.ui.VaultViewModel
import com.conquered.time.ui.theme.ConqueredTimeTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            ConqueredTimeTheme {
                Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                    val vm: VaultViewModel = viewModel()
                    when (val s = vm.screen) {
                        is VaultScreen.Import -> ImportScreen(
                            busy = vm.busy,
                            error = vm.error,
                            onPick = vm::importVault,
                        )
                        is VaultScreen.Unlock -> UnlockScreen(
                            profiles = s.profiles,
                            busy = vm.busy,
                            error = vm.error,
                            onUnlock = vm::unlock,
                            onBack = vm::reset,
                            onPasswordChange = vm::clearError,
                        )
                        is VaultScreen.Browse -> BrowseScreen(
                            companies = s.companies,
                            entries = s.entries,
                            onLock = vm::reset,
                        )
                    }
                }
            }
        }
    }
}
