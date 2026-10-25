package com.praveenjuge.teak.feature.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.praveenjuge.teak.core.data.TeakConfig
import com.praveenjuge.teak.core.data.auth.SessionState
import com.praveenjuge.teak.core.data.catchingFailures
import com.praveenjuge.teak.core.data.prefs.PreferencesRepository
import com.praveenjuge.teak.core.data.prefs.ThemePreference
import com.praveenjuge.teak.core.data.repository.AccountRepository
import com.praveenjuge.teak.core.data.repository.LanguageRepository
import com.praveenjuge.teak.core.model.CurrentUser
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

enum class DeleteStep { None, Warning, Confirm }

/** What the last language change in Settings did. */
sealed interface LanguageNotice {
    /** Saved; Undo switches back to [undoTo]. */
    data class Changed(val undoTo: String) : LanguageNotice

    data object Failed : LanguageNotice
}

data class SettingsUiState(
    val theme: ThemePreference = ThemePreference.System,
    val language: String = "en",
    val isChangingLanguage: Boolean = false,
    val languageNotice: LanguageNotice? = null,
    val email: String? = null,
    val usage: String? = null,
    val plan: String? = null,
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
    private val language: LanguageRepository,
    config: TeakConfig,
) : ViewModel() {
    val versionName: String = config.versionName

    private val local = MutableStateFlow(SettingsUiState())

    val uiState: StateFlow<SettingsUiState> = combine(
        local,
        preferences.theme,
        account.session,
        account.currentUser,
        language.current,
    ) { local, theme, session, user, code ->
        val current: CurrentUser? = user.getOrNull()
        local.copy(
            theme = theme,
            language = code,
            email = (session as? SessionState.SignedIn)?.user?.email,
            usage = when {
                user.isFailure -> "Not available"
                current == null -> "Not available"
                else -> current.usageLabel
            },
            plan = current?.plan,
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), SettingsUiState())

    fun setTheme(theme: ThemePreference) {
        viewModelScope.launch { preferences.setTheme(theme) }
    }

    /** Switches the app's language now and saves it to the account, with Undo. */
    fun chooseLanguage(code: String) {
        val previous = language.current.value
        if (code == previous || local.value.isChangingLanguage) return
        local.update { it.copy(isChangingLanguage = true, languageNotice = null) }
        viewModelScope.launch {
            val notice = catchingFailures { language.choose(code) }
                .fold({ LanguageNotice.Changed(undoTo = previous) }, { LanguageNotice.Failed })
            local.update { it.copy(isChangingLanguage = false, languageNotice = notice) }
        }
    }

    fun undoLanguage() {
        val notice = local.value.languageNotice as? LanguageNotice.Changed ?: return
        chooseLanguage(notice.undoTo)
    }

    fun dismissLanguageNotice() = local.update { it.copy(languageNotice = null) }

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
        local.update { it.copy(deleteStep = DeleteStep.Warning, error = null) }
    }

    fun continueDelete() = local.update { it.copy(deleteStep = DeleteStep.Confirm) }

    fun cancelDelete() = local.update { it.copy(deleteStep = DeleteStep.None) }

    fun confirmDelete(typed: String) {
        if (typed.trim().lowercase() != DELETE_PHRASE) return
        local.update { it.copy(deleteStep = DeleteStep.None, isDeleting = true) }
        viewModelScope.launch {
            catchingFailures { account.deleteAccount() }
                .onSuccess { local.update { it.copy(isDeleting = false) } }
                .onFailure {
                    local.update {
                        it.copy(isDeleting = false, error = "Something went wrong while deleting your account.")
                    }
                }
        }
    }

    fun dismissError() = local.update { it.copy(error = null) }

    companion object {
        const val DELETE_PHRASE = "delete account"
    }
}
