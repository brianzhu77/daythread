#if canImport(UIKit)
  import SwiftUI

  /// Email, password and "Sign in"; a refusal is one line under the button, in the web's words
  /// (`src/routes/sign-in.tsx`).
  struct SignInView: View {
    let model: AppModel

    @State private var email = ""
    @State private var password = ""
    @State private var busy = false
    @State private var failure: SignInFailure?
    @FocusState private var focus: Field?

    private enum Field { case email, password }

    private var canSubmit: Bool {
      !busy && !email.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !password.isEmpty
    }

    var body: some View {
      NavigationStack {
        Form {
          Section {
            TextField("Email", text: $email)
              .textContentType(.emailAddress)
              .keyboardType(.emailAddress)
              .textInputAutocapitalization(.never)
              .autocorrectionDisabled()
              .focused($focus, equals: .email)
              .submitLabel(.next)
              .onSubmit { focus = .password }
            SecureField("Password", text: $password)
              .textContentType(.password)
              .focused($focus, equals: .password)
              .submitLabel(.go)
              .onSubmit(submit)
          }
          .disabled(busy)

          Section {
            Button(action: submit) {
              Text("Sign in").frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(!canSubmit)
            .listRowInsets(EdgeInsets())
            .listRowBackground(Color.clear)
          } footer: {
            if let failure {
              Text(failure.message)
            }
          }
        }
        .navigationTitle("Daythread")
      }
    }

    private func submit() {
      guard canSubmit else { return }
      busy = true
      failure = nil
      Task {
        let failure = await model.signIn(email: email, password: password)
        busy = false
        self.failure = failure
        // As on the web: the address stays, the password empties and takes the caret.
        if failure == .wrong {
          password = ""
          focus = .password
        }
      }
    }
  }

  extension SignInFailure {
    /// The web's line for each case.
    var message: String {
      switch self {
      case .wrong: "That didn't work · Check the email and password"
      case .unconfirmed: "Confirm your email first"
      case .notInvited: "This address isn't on the invite list yet"
      case .wait(let seconds): "Too many tries · Try again \(Self.within(seconds))"
      case .offline, .unavailable: "Couldn't sign in · Try again"
      }
    }

    /// "in 30 s" under a minute, else "in 4 min", rounded up.
    private static func within(_ seconds: Int) -> String {
      seconds < 60 ? "in \(max(1, seconds)) s" : "in \((seconds + 59) / 60) min"
    }
  }
#endif
