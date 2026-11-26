#if canImport(UIKit)
  import UIKit

  /// The signed-in app: the system's tab bar, with its default appearance, holding the web's five places and the
  /// system's search tab (`native-phase-1.md` §6). Today holds the day screen; a place not built yet says so.
  @MainActor
  final class AppTabBarController: UITabBarController, UITabBarControllerDelegate {
    private let model: AppModel
    let dayScreen: DayViewController
    private let todayTab: UITab

    init(model: AppModel) {
      self.model = model
      dayScreen = DayViewController(model: model)
      let navigation = UINavigationController(rootViewController: dayScreen)
      let places = AppTabs.places(today: model.today)
      let today = places[0]
      todayTab = UITab(title: today.title, image: UIImage(systemName: today.symbol), identifier: today.id) { _ in
        navigation
      }
      super.init(nibName: nil, bundle: nil)
      let others = places.dropFirst().map { place in
        UITab(title: place.title, image: UIImage(systemName: place.symbol), identifier: place.id) { _ in
          NotInTheAppYetViewController(title: place.title, symbol: place.symbol)
        }
      }
      // The system draws its search tab apart, at the end of the bar, where the web has its round Search button, but
      // only when the compact bar has room: with five places it keeps four and puts Tags and Search under its own More
      // tab. That is the system's default, kept; which place gives way is Brian's to say.
      let search = UISearchTab { _ in NotInTheAppYetViewController(title: "Search", symbol: "magnifyingglass") }
      tabs = [todayTab] + others + [search]
      delegate = self
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    /// UIKit calls this again when `model.today` changes: the Today tab shows the day of the month.
    override func updateProperties() {
      super.updateProperties()
      let symbol = AppTabs.places(today: model.today)[0].symbol
      todayTab.image = UIImage(systemName: symbol)
    }

    // MARK: UITabBarControllerDelegate

    /// The web's Today tab is `/`: it goes back to today from another day, and tapped again on today, to the top.
    func tabBarController(_ tabBarController: UITabBarController, shouldSelectTab tab: UITab) -> Bool {
      guard tab === todayTab else { return true }
      if dayScreen.shownDate != nil {
        dayScreen.open(nil)
      } else if selectedTab === todayTab {
        dayScreen.scrollToTop()
      }
      return true
    }
  }

  /// A place the app does not have yet: its symbol, its name, and that it is not here yet. Nothing to press.
  @MainActor
  final class NotInTheAppYetViewController: UIViewController {
    private let place: String
    private let symbol: String

    init(title: String, symbol: String) {
      place = title
      self.symbol = symbol
      super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override func viewDidLoad() {
      super.viewDidLoad()
      view.backgroundColor = .systemBackground
      var configuration = UIContentUnavailableConfiguration.empty()
      configuration.image = UIImage(systemName: symbol)
      configuration.text = place
      configuration.secondaryText = "Not in the app yet"
      contentUnavailableConfiguration = configuration
    }
  }
#endif
