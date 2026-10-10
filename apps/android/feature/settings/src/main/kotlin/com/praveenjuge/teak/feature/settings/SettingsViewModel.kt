package com.praveenjuge.teak.feature.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.praveenjuge.teak.core.data.TeakConfig
import com.praveenjuge.teak.core.data.auth.SessionState
import com.praveenjuge.teak.core.data.prefs.PreferencesRepository
import com.praveenjuge.teak.core.data.prefs.ThemePreference
import com.praveenjuge.teak.core.data.repository.AccountRepository
import com.praveenjuge.teak.core.model.CurrentUser
import com.praveenjuge.teak.core.model.TeakMessages
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/** Where the delete-account flow is: the warning, then the typed confirmation. */
enum class DeleteStep { None, Warning, Confirm }

data class SettingsUiState(
    val theme: ThemePreference = ThemePreference.System,
    val email: String? = null,
    /** Null while loading. */
    val usage: String? = null,
    val plan: String? = null,
    val accountChangesPaused: Boolean = false,
    val deleteStep: DeleteStep = DeleteStep.None,
    val isDeleting: Boolean = false,
    val isSigningOut: Boolean = false,
    val confirmSignOut: Boolean = false,
    val error: String? = null,
)

@HiltViewModel
class SettingsViewModel @Inject constructor(
    private val account: AccountRepository,
    private val preferences: PreferencesRepository,
    config: TeakConfig,
) : ViewModel() {
    /** Shown under About. */
    val versionName: String = config.versionName

    private val local = MutableStateFlow(SettingsUiState())

    val uiState: StateFlow<SettingsUiState> = combine(
        local,
        preferences.theme,
        account.session,
        account.currentUser,
        account.authMode,
    ) { local, theme, session, user, mode ->
        val current: CurrentUser? = user.getOrNull()
        local.copy(
            theme = theme,
            email = (session as? SessionState.SignedIn)?.user?.email,
            usage = when {
                user.isFailure -> "Not available"
                current == null -> "Not available"
                else -> current.usageLabel
            },
            plan = current?.plan,
            accountChangesPaused = mode?.accountChangesPaused == true,
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), SettingsUiState())

    fun setTheme(theme: ThemePreference) {
        viewModelScope.launch { preferences.setTheme(theme) }
    }

    fun requestSignOut() = local.update { it.copy(confirmSignOut = true) }

    fun cancelSignOut() = local.update { it.copy(confirmSignOut = false) }

    fun signOut() {
        local.update { it.copy(confirmSignOut = false, isSigningOut = true) }
        viewModelScope.launch {
            account.signOut()
            local.update { it.copy(isSigningOut = false) }
        }
    }

    fun requestDelete() {
        if (uiState.value.accountChangesPaused) {
            local.update { it.copy(error = TeakMessages.ACCOUNT_CHANGES_PAUSED) }
            return
        }
        local.update { it.copy(deleteStep = DeleteStep.Warning, error = null) }
    }

    fun continueDelete() = local.update { it.copy(deleteStep = DeleteStep.Confirm) }

    fun cancelDelete() = local.update { it.copy(deleteStep = DeleteStep.None) }

    /** Deletes only when [typed] is "delete account", ignoring case and surrounding spaces. */
    fun confirmDelete(typed: String) {
        if (typed.trim().lowercase() != DELETE_PHRASE) return
        local.update { it.copy(deleteStep = DeleteStep.None, isDeleting = true) }
        viewModelScope.launch {
            try {
                account.deleteAccount()
                local.update { it.copy(isDeleting = false) }
            } catch (e: Exception) {
                val message = if (uiState.value.accountChangesPaused) {
                    TeakMessages.ACCOUNT_CHANGES_PAUSED
                } else {
                    "Something went wrong while deleting your account."
                }
                local.update { it.copy(isDeleting = false, error = message) }
            }
        }
    }

    fun dismissError() = local.update { it.copy(error = null) }

    companion object {
        const val DELETE_PHRASE = "delete account"
    }
}
