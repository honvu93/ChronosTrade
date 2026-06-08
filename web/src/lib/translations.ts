import { AppLocale, DEFAULT_APP_LOCALE } from "./appLocale";

export interface TranslationCatalog {
    common: {
        language: string;
        english: string;
        vietnamese: string;
        signOut: string;
        loading: string;
        requestFailed: string;
    };
    navigation: {
        chart: string;
        signals: string;
        reports: string;
        trading: string;
        engine: string;
        indicators: string;
        admin: string;
    };
    authenticatedEntry: {
        authenticatedEntry: string;
        defaultLanding: string;
    };
    workspace: {
        sharedShell: string;
        chartWorkspace: string;
        primaryMarketContext: string;
        indicatorOverlays: string;
        timeframeLabels: Record<string, string>;
        routeContext: {
            adminMonitoring: { moduleLabel: string; title: string; description: string };
            adminIndicatorCatalog: { moduleLabel: string; title: string; description: string };
            adminAccess: { moduleLabel: string; title: string; description: string };
            signalsBacktests: { moduleLabel: string; title: string; description: string };
            signalsComposer: { moduleLabel: string; title: string; description: string };
            signals: { moduleLabel: string; title: string; description: string };
            reports: { moduleLabel: string; title: string; description: string };
            trading: { moduleLabel: string; title: string; description: string };
            engine: { moduleLabel: string; title: string; description: string };
            indicators: { moduleLabel: string; title: string; description: string };
            chart: { moduleLabel: string; title: string; description: string };
        };
    };
    topNav: {
        searchPlaceholder: string;
        clearSymbolSearch: string;
        symbolContext: string;
        noSymbolsFound: string;
        marketSource: string;
        mt5Source: string;
    };
    timeframeSwitcher: {
        ariaLabel: string;
    };
    login: {
        authenticatedLogin: string;
        title: string;
        description: string;
        adminLane: string;
        adminLaneTitle: string;
        adminLaneDescription: string;
        userLane: string;
        userLaneTitle: string;
        userLaneDescription: string;
        sessionGate: string;
        emailOrUsername: string;
        emailOrUsernamePlaceholder: string;
        password: string;
        passwordPlaceholder: string;
        signIn: string;
        signInFallbackError: string;
    };
    watchlist: {
        title: string;
        description: string;
        empty: string;
        volumePrefix: string;
    };
    syncStatus: {
        candles: string;
        oldestData: string;
        latestData: string;
        unavailable: string;
    };
    indicatorCatalog: {
        title: string;
        subtitle: string;
        categories: Record<string, string>;
    };
    compositionCanvas: {
        matchMode: Record<"ALL" | "ANY" | "SEQUENCE", string>;
        windowLabel: string;
        barsLabel: string;
        emptyPrompt: string;
        sequenceHint: string;
        then: string;
        editParameters: string;
        indicatorParams: string;
        conditionParams: string;
    };
    notification: {
        smartAlertTriggered: string;
        live: string;
    };
    accessGate: {
        accessControl: string;
        restoringSession: string;
        validatingSession: string;
        redirectingToSignIn: string;
        redirectingMessage: string;
        adminAccessRequired: string;
        adminAccessRequiredMessage: string;
        openAllowedWorkspace: string;
        moduleAccessNotEnabled: string;
        moduleGatedMessage: string;
    };
    alertConfig: {
        configureSmartAlert: string;
        alertType: string;
        priceAction: string;
        signalMatrix: string;
        greaterThanOrEqual: string;
        lessThanOrEqual: string;
        targetPrice: string;
        notifyPriceCross: string;
        selectSignalEvent: string;
        entryPrimary: string;
        entryConfirmedStrict: string;
        tp1HitSuccess: string;
        stopHitFailure: string;
        notifyEngineEvent: string;
        cancel: string;
        saving: string;
        activateAlert: string;
    };
    gettingStarted: {
        getStarted: string;
        complete: string;
        mt5Connected: string;
        connect: string;
        backtestCompleted: string;
        runBacktests: string;
        liveEligibleSignal: string;
        viewSignals: string;
        paperTradingActive: string;
        setUp: string;
        ariaLabel: string;
        dismiss: string;
    };
    indicatorSettings: {
        advancedSettings: string;
        strategyParameters: string;
        jsonConfig: string;
        syntaxError: string;
        capabilities: string;
        riskGuard: string;
        enabledInCode: string;
        liveExecution: string;
        manualApproval: string;
        reset: string;
        saveParameters: string;
    };
    indicatorLogs: {
        liveExecutionLogs: string;
        autoScroll: string;
        clear: string;
        waitingForExecution: string;
    };
    signalReview: {
        signalReview: string;
        runBacktest: string;
        reuseAsNew: string;
        retiredSnapshot: string;
        reopen: string;
        retireSignalAria: string;
        retiring: string;
        retire: string;
        inheritedFromRuntime: string;
        lifecycle: string;
        lineage: string;
        derivedFrom: string;
        inspectOriginal: string;
        refinements: string;
        inspect: string;
        ruleStructure: string;
        signalContext: string;
        direction: string;
        conditions: string;
        connector: string;
        tradePlan: string;
        entry: string;
        protection: string;
        exit: string;
        conditionFlow: string;
        catalogDefaults: string;
        closeSignalReview: string;
    };
    tradingReadiness: {
        title: string;
        description: string;
        refresh: string;
        tradingReadBlocked: string;
        mt5SetupReadNeeded: string;
        evaluatingReadiness: string;
        readinessCheckFailed: string;
        account: string;
        mode: string;
        mt5Login: string;
        mt5Server: string;
        bridgePort: string;
        readinessChecks: string;
        blockingReasons: string;
        readyToActivate: string;
    };
    tradingConnection: {
        mt5AccountSetup: string;
        manageAccounts: string;
        refresh: string;
        addAccount: string;
        connectionSetupAvailable: string;
        mt5SetupReadNeeded: string;
        accountOwnerScope: string;
        adminDefaultsPersonal: string;
        chooseUserInspect: string;
        viewingAccountsFor: string;
        myAccounts: string;
        currentScope: string;
        loadingSetup: string;
        requestFailed: string;
        savedAccounts: string;
        accountCount: string;
        active: string;
        noAccountSaved: string;
        createNewAccount: string;
        selectedAccount: string;
        newMt5Account: string;
        chooseAnAccount: string;
        addAnotherAccount: string;
        editSelectedAccount: string;
        selectOrAdd: string;
        edit: string;
        currentlyActive: string;
        setActive: string;
        delete: string;
        accountLabel: string;
        tradingMode: string;
        paperDemo: string;
        paperDemoDescription: string;
        live: string;
        liveDescription: string;
        paperModeHelper: string;
        liveModeHelper: string;
        mt5Login: string;
        mt5Server: string;
        mt5Password: string;
        passwordKeepBlank: string;
        passwordEncrypted: string;
        saveNewAccount: string;
        saveAccountChanges: string;
        createAccount: string;
        cancelNewAccount: string;
        accountLabelRequired: string;
        mt5LoginRequired: string;
        mt5ServerRequired: string;
        mt5PasswordRequired: string;
        serverDemoModeLive: string;
        serverNotDemoModePaper: string;
        unableToLoadUsers: string;
    };
    paperWizard: {
        startPaperTrading: string;
        account: string;
        risk: string;
        review: string;
        loadingAccounts: string;
        noPaperAccountFound: string;
        connectPaperFirst: string;
        goToAccountSettings: string;
        paperAccount: string;
        autoSelected: string;
        selectPaperAccount: string;
        riskPerTrade: string;
        maxOpenPositions: string;
        autoCalculatedGuardrails: string;
        dailyLossCap: string;
        killSwitchDrawdown: string;
        signal: string;
        riskConfig: string;
        riskTrade: string;
        maxPositions: string;
        dailyCap: string;
        killSwitch: string;
        setupFailed: string;
        activating: string;
        approveAndActivate: string;
        paperTradingActive: string;
        signalRunningPaper: string;
        monitorAutomation: string;
        back: string;
        next: string;
        backToRiskConfig: string;
        approveActivateAria: string;
        closeWizard: string;
    };
    chartStatus: {
        candles: string;
        lastUpdated: string;
    };
    errorBoundary: {
        somethingWentWrong: string;
        failedToRender: string;
        tryAgain: string;
    };
    modulePlaceholder: {
        openEngine: string;
    };
}

const translations = {
    en: {
        common: {
            language: "Language",
            english: "English",
            vietnamese: "Vietnamese",
            signOut: "Sign out",
            loading: "Loading...",
            requestFailed: "Request failed",
        },
        navigation: {
            chart: "Chart",
            signals: "Signals",
            reports: "Analytics",
            trading: "Trading",
            engine: "Analytics",
            indicators: "Indicators",
            admin: "Admin",
        },
        authenticatedEntry: {
            authenticatedEntry: "Authenticated Entry",
            defaultLanding: "Default Landing",
        },
        workspace: {
            sharedShell: "Shared Shell",
            chartWorkspace: "Chart Workspace",
            primaryMarketContext: "Primary market context",
            indicatorOverlays: "Indicators",
            timeframeLabels: {
                "1m": "1 Minute",
                "5m": "5 Minutes",
                "15m": "15 Minutes",
                "30m": "30 Minutes",
                "1h": "1 Hour",
                "2h": "2 Hours",
                "3h": "3 Hours",
                "4h": "4 Hours",
                "12h": "12 Hours",
                "1d": "1 Day",
                "1w": "1 Week",
                "1M": "1 Month",
            },
            routeContext: {
                adminMonitoring: {
                    moduleLabel: "Admin",
                    title: "Monitoring Control Deck",
                    description: "Track system health, data growth, and failure lanes from a single admin-only surface.",
                },
                adminIndicatorCatalog: {
                    moduleLabel: "Admin",
                    title: "Indicator Catalog Governance Deck",
                    description: "Review runtime bindings, lifecycle state, and dependency impact before publishing or retiring indicator catalog rows.",
                },
                adminAccess: {
                    moduleLabel: "Admin",
                    title: "Access Control Deck",
                    description: "Manage users, module grants, and protected workspace access from the same command shell.",
                },
                signalsBacktests: {
                    moduleLabel: "Backtest",
                    title: "Validation And Evidence Deck",
                    description: "Review run metrics, trade evidence, and promotion readiness without losing signal lineage.",
                },
                signalsComposer: {
                    moduleLabel: "Signals",
                    title: "Strategy Composition Deck",
                    description: "Compose reusable signal logic, validate structure, and hand off into backtest with visible context.",
                },
                signals: {
                    moduleLabel: "Signals",
                    title: "Signal Operations Deck",
                    description: "Generate, import, review, and manage signal runs from the shared chart-first workspace.",
                },
                reports: {
                    moduleLabel: "Reports",
                    title: "Explainable Reports Deck",
                    description: "Inspect confidence narratives, trace evidence, and export validation artifacts with preserved run context.",
                },
                trading: {
                    moduleLabel: "Trading",
                    title: "Runtime Trading Control Deck",
                    description: "Evaluate guarded live-readiness, capability tiers, and operator boundaries without leaving the shared shell.",
                },
                engine: {
                    moduleLabel: "Engine",
                    title: "Analytics And Runtime Deck",
                    description: "Inspect engine analytics, monitoring outputs, and investigative breakdowns in the same operational frame.",
                },
                indicators: {
                    moduleLabel: "Indicators",
                    title: "Indicator Operations Deck",
                    description: "Review live indicator runtime state, alerts, and diagnostic signals inside the analytical command shell.",
                },
                chart: {
                    moduleLabel: "Chart",
                    title: "Chart Context Deck",
                    description: "Keep symbol, timeframe, freshness, and inspection context visible while chart analysis remains the dominant workspace.",
                },
            },
        },
        topNav: {
            searchPlaceholder: "Search market symbols...",
            clearSymbolSearch: "Clear symbol search",
            symbolContext: "Symbol Context",
            noSymbolsFound: "No symbols found matching \"{{search}}\"",
            marketSource: "Market",
            mt5Source: "MT5",
        },
        timeframeSwitcher: {
            ariaLabel: "Select timeframe",
        },
        login: {
            authenticatedLogin: "Authenticated Login",
            title: "Sign in to unlock your assigned trading workspaces.",
            description: "Admin accounts can manage users and every module. Standard users only land in modules explicitly granted by admin across chart, signal, report, trading, and engine.",
            adminLane: "Admin lane",
            adminLaneTitle: "User management + full system",
            adminLaneDescription: "Create accounts, enable modules, disable users, and access every protected route.",
            userLane: "User lane",
            userLaneTitle: "Module-scoped access",
            userLaneDescription: "The first allowed route becomes the post-login landing path, while blocked modules stay hidden and protected.",
            sessionGate: "Session Gate",
            emailOrUsername: "Email or username",
            emailOrUsernamePlaceholder: "admin or admin@tvgit.local",
            password: "Password",
            passwordPlaceholder: "Enter your password",
            signIn: "Sign in",
            signInFallbackError: "Unable to sign in.",
        },
        watchlist: {
            title: "Watchlist",
            description: "Keep market context visible without leaving the active workspace.",
            empty: "No symbols found.",
            volumePrefix: "Vol",
        },
        syncStatus: {
            candles: "candles",
            oldestData: "Oldest data",
            latestData: "Latest data",
            unavailable: "--/--/---- --:--",
        },
        indicatorCatalog: {
            title: "Indicator Catalog",
            subtitle: "Click condition to add to canvas",
            categories: {
                momentum: "Momentum",
                trend: "Trend",
                structure: "Structure",
                volatility: "Volatility",
                fibonacci: "Fibonacci",
                utility: "Utility",
                other: "Other",
            },
        },
        compositionCanvas: {
            matchMode: {
                ALL: "ALL - every condition must match within the same window",
                ANY: "ANY - at least one condition must match",
                SEQUENCE: "SEQUENCE - conditions must match in order",
            },
            windowLabel: "window",
            barsLabel: "bars",
            emptyPrompt: "Choose a condition from the catalog on the left to add it here.",
            sequenceHint: "The order below is the sequence the conditions must match.",
            then: "then",
            editParameters: "Edit parameters",
            indicatorParams: "Indicator Params",
            conditionParams: "Condition Params",
        },
        notification: {
            smartAlertTriggered: "Smart Alert Triggered",
            live: "LIVE",
        },
        accessGate: {
            accessControl: "Access Control",
            restoringSession: "Restoring your session",
            validatingSession: "Validating session...",
            redirectingToSignIn: "Redirecting to sign-in",
            redirectingMessage: "Protected modules now require an authenticated session. Redirecting to /login.",
            adminAccessRequired: "Admin access required",
            adminAccessRequiredMessage: "Admin access required.",
            openAllowedWorkspace: "Open allowed workspace",
            moduleAccessNotEnabled: "{{modules}} access is not enabled for this account",
            moduleGatedMessage: "The current session is active, but this route is gated behind the {{modules}} module. Ask an admin to update your grants or continue in an allowed workspace.",
        },
        alertConfig: {
            configureSmartAlert: "Configure Smart Alert",
            alertType: "Alert Type",
            priceAction: "Price Action",
            signalMatrix: "Signal Matrix",
            greaterThanOrEqual: "Greater than or equal",
            lessThanOrEqual: "Less than or equal",
            targetPrice: "Target Price",
            notifyPriceCross: "Notify when {{symbol}} price crosses this level.",
            selectSignalEvent: "Select Signal Event",
            entryPrimary: "ENTRY (Primary Signal)",
            entryConfirmedStrict: "ENTRY_CONFIRMED (Strict)",
            tp1HitSuccess: "TP1 HIT (Success)",
            stopHitFailure: "STOP HIT (Error/Failure)",
            notifyEngineEvent: "Notify when {{name}} generates this specific engine event.",
            cancel: "Cancel",
            saving: "Saving...",
            activateAlert: "Activate Alert",
        },
        gettingStarted: {
            getStarted: "Get started",
            complete: "complete",
            mt5Connected: "MT5 account connected",
            connect: "Connect",
            backtestCompleted: "Backtest completed",
            runBacktests: "Run backtests",
            liveEligibleSignal: "Live-eligible signal",
            viewSignals: "View signals",
            paperTradingActive: "Paper trading active",
            setUp: "Set up",
            ariaLabel: "Getting started with paper trading",
            dismiss: "Dismiss getting started checklist",
        },
        indicatorSettings: {
            advancedSettings: "Advanced Settings",
            strategyParameters: "Strategy Parameters",
            jsonConfig: "JSON Config",
            syntaxError: "Syntax Error: {{error}}",
            capabilities: "Capabilities",
            riskGuard: "Risk Guard",
            enabledInCode: "Enabled in code",
            liveExecution: "Live Execution",
            manualApproval: "Manual Approval",
            reset: "Reset",
            saveParameters: "Save Parameters",
        },
        indicatorLogs: {
            liveExecutionLogs: "Live Execution Logs",
            autoScroll: "Auto-scroll",
            clear: "Clear",
            waitingForExecution: "Waiting for indicator execution...",
        },
        signalReview: {
            signalReview: "Signal Review",
            runBacktest: "Run Backtest",
            reuseAsNew: "Reuse as new",
            retiredSnapshot: "Retired snapshot",
            reopen: "Reopen",
            retireSignalAria: "Retire signal",
            retiring: "Retiring...",
            retire: "Retire",
            inheritedFromRuntime: "Inherited from runtime",
            lifecycle: "Lifecycle",
            lineage: "Lineage",
            derivedFrom: "Derived From",
            inspectOriginal: "Inspect original",
            refinements: "Refinements",
            inspect: "Inspect",
            ruleStructure: "Rule Structure",
            signalContext: "Signal Context",
            direction: "Direction",
            conditions: "Conditions",
            connector: "Connector",
            tradePlan: "Trade Plan",
            entry: "Entry",
            protection: "Protection",
            exit: "Exit",
            conditionFlow: "Condition Flow",
            catalogDefaults: "Uses the catalog defaults for this block.",
            closeSignalReview: "Close signal review",
        },
        tradingReadiness: {
            title: "Account Credential & Connection Readiness",
            description: "Checks the currently active MT5 account, or a specifically selected saved account in Account Setup, verifies encryption support, and confirms whether the bridge process is reachable for trading-read workflows.",
            refresh: "Refresh",
            tradingReadBlocked: "Trading read remains runtime-blocked",
            mt5SetupReadNeeded: "MT5 setup available. Other surfaces need read tier.",
            evaluatingReadiness: "Evaluating account readiness...",
            readinessCheckFailed: "Readiness check failed",
            account: "Account",
            mode: "Mode",
            mt5Login: "MT5 Login",
            mt5Server: "MT5 Server",
            bridgePort: "Bridge Port",
            readinessChecks: "Readiness Checks",
            blockingReasons: "Blocking Reasons",
            readyToActivate: "The saved MT5 account and connection infrastructure are confirmed. Trading-read reviews can rely on this broker context once the runtime read gate is enabled.",
        },
        tradingConnection: {
            mt5AccountSetup: "MT5 Account Setup",
            manageAccounts: "Manage MT5 accounts",
            refresh: "Refresh",
            addAccount: "Add Account",
            connectionSetupAvailable: "Connection setup is available before trading read is enabled",
            mt5SetupReadNeeded: "MT5 setup available. Read tier needed for more.",
            accountOwnerScope: "Account owner scope",
            adminDefaultsPersonal: "Admin defaults to personal MT5 accounts until another user is explicitly selected.",
            chooseUserInspect: "Choose a user here only when you intentionally need to inspect or manage that user's saved MT5 accounts.",
            viewingAccountsFor: "Viewing accounts for",
            myAccounts: "My accounts ({{name}})",
            currentScope: "Current scope:",
            loadingSetup: "Loading MT5 account setup...",
            requestFailed: "MT5 account request failed",
            savedAccounts: "Saved Accounts",
            accountCount: "{{count}} account(s) {{scope}}.",
            active: "Active: {{label}}",
            noAccountSaved: "No MT5 account is saved yet. Add the first account to create the encrypted broker connection for {{scope}}.",
            createNewAccount: "Create New Account",
            selectedAccount: "Selected Account",
            newMt5Account: "New MT5 account",
            chooseAnAccount: "Choose an account",
            addAnotherAccount: "Add another saved MT5 account without replacing the current active one.",
            editSelectedAccount: "Edit the selected saved account, or set it as the active Trading account.",
            selectOrAdd: "Select an existing account or add a new one.",
            edit: "Edit",
            currentlyActive: "Currently Active",
            setActive: "Set Active",
            delete: "Delete",
            accountLabel: "Account label",
            tradingMode: "Trading mode",
            paperDemo: "Paper / Demo",
            paperDemoDescription: "Use MT5 demo credentials for full write and automation rehearsal without live capital.",
            live: "Live",
            liveDescription: "Use production broker credentials and keep stronger responsibility messaging in Trading.",
            paperModeHelper: "Paper accounts should use MT5 demo credentials so full write and automation flows stay non-live.",
            liveModeHelper: "Live accounts keep the current MT5 execution behavior and should be used only when the broker context is production-ready.",
            mt5Login: "MT5 login",
            mt5Server: "MT5 server",
            mt5Password: "MT5 password",
            passwordKeepBlank: "Leave MT5 password blank to keep the currently saved secret.",
            passwordEncrypted: "The password is stored encrypted on the backend with ENCRYPTION_KEY.",
            saveNewAccount: "Save New Account",
            saveAccountChanges: "Save Account Changes",
            createAccount: "Create Account",
            cancelNewAccount: "Cancel New Account",
            accountLabelRequired: "Account label is required.",
            mt5LoginRequired: "MT5 login is required.",
            mt5ServerRequired: "MT5 server is required.",
            mt5PasswordRequired: "MT5 password is required for a new connection.",
            serverDemoModeLive: "The MT5 server name suggests a demo environment, but the account mode is set to Live. Double-check before saving.",
            serverNotDemoModePaper: "The MT5 server name does not look like a demo server, but the account mode is set to Paper. Verify the credentials match your intent.",
            unableToLoadUsers: "Unable to load managed users.",
        },
        paperWizard: {
            startPaperTrading: "Start Paper Trading",
            account: "Account",
            risk: "Risk",
            review: "Review",
            loadingAccounts: "Loading accounts…",
            noPaperAccountFound: "No paper MT5 account found",
            connectPaperFirst: "Connect a paper/demo MT5 account first before setting up paper trading.",
            goToAccountSettings: "Go to account settings →",
            paperAccount: "Paper account",
            autoSelected: "Auto-selected. Add more paper accounts if you need to switch.",
            selectPaperAccount: "Select paper account",
            riskPerTrade: "Risk per trade",
            maxOpenPositions: "Max open positions",
            autoCalculatedGuardrails: "Auto-calculated guardrails",
            dailyLossCap: "Daily loss cap",
            killSwitchDrawdown: "Kill switch drawdown",
            signal: "Signal",
            riskConfig: "Risk config",
            riskTrade: "Risk/trade",
            maxPositions: "Max positions",
            dailyCap: "Daily cap",
            killSwitch: "Kill switch",
            setupFailed: "Setup failed: ",
            activating: "Activating…",
            approveAndActivate: "Approve & Activate",
            paperTradingActive: "Paper trading active",
            signalRunningPaper: "{{name}} is now running in paper mode.",
            monitorAutomation: "Monitor it in the Automation tab.",
            back: "Back",
            next: "Next",
            backToRiskConfig: "← Back to risk config",
            approveActivateAria: "Approve and activate paper trading",
            closeWizard: "Close wizard",
        },
        chartStatus: {
            candles: "candles",
            lastUpdated: "Last updated:",
        },
        errorBoundary: {
            somethingWentWrong: "Something went wrong",
            failedToRender: "Failed to render this component.",
            tryAgain: "Try again",
        },
        modulePlaceholder: {
            openEngine: "Open Engine",
        },
    },
    vi: {
        common: {
            language: "Ngôn ngữ",
            english: "Tiếng Anh",
            vietnamese: "Tiếng Việt",
            signOut: "Đăng xuất",
            loading: "Đang tải...",
            requestFailed: "Yêu cầu thất bại",
        },
        navigation: {
            chart: "Biểu đồ",
            signals: "Tín hiệu",
            reports: "Phân tích",
            trading: "Giao dịch",
            engine: "Phân tích",
            indicators: "Chỉ báo",
            admin: "Quản trị",
        },
        authenticatedEntry: {
            authenticatedEntry: "Điểm vào đã xác thực",
            defaultLanding: "Trang vào mặc định",
        },
        workspace: {
            sharedShell: "Khung dùng chung",
            chartWorkspace: "Không gian biểu đồ",
            primaryMarketContext: "Ngữ cảnh thị trường chính",
            indicatorOverlays: "Chỉ báo",
            timeframeLabels: {
                "1m": "1 phút",
                "5m": "5 phút",
                "15m": "15 phút",
                "30m": "30 phút",
                "1h": "1 giờ",
                "2h": "2 giờ",
                "3h": "3 giờ",
                "4h": "4 giờ",
                "12h": "12 giờ",
                "1d": "1 ngày",
                "1w": "1 tuần",
                "1M": "1 tháng",
            },
            routeContext: {
                adminMonitoring: {
                    moduleLabel: "Quản trị",
                    title: "Bảng điều khiển giám sát",
                    description: "Theo dõi sức khỏe hệ thống, tăng trưởng dữ liệu và các luồng lỗi trên một bề mặt chỉ dành cho quản trị.",
                },
                adminIndicatorCatalog: {
                    moduleLabel: "Quản trị",
                    title: "Bảng quản trị danh mục chỉ báo",
                    description: "Xem runtime binding, trạng thái vòng đời và tác động phụ thuộc trước khi phát hành hoặc ngừng một dòng chỉ báo.",
                },
                adminAccess: {
                    moduleLabel: "Quản trị",
                    title: "Bảng kiểm soát truy cập",
                    description: "Quản lý người dùng, quyền module và truy cập workspace được bảo vệ ngay trong cùng command shell.",
                },
                signalsBacktests: {
                    moduleLabel: "Backtest",
                    title: "Bảng kiểm định và bằng chứng",
                    description: "Xem chỉ số chạy, bằng chứng giao dịch và mức sẵn sàng promotion mà không mất dấu vết tín hiệu.",
                },
                signalsComposer: {
                    moduleLabel: "Tín hiệu",
                    title: "Bảng soạn thảo chiến lược",
                    description: "Kết hợp logic tín hiệu tái sử dụng, kiểm tra cấu trúc và chuyển sang backtest với ngữ cảnh luôn hiển thị.",
                },
                signals: {
                    moduleLabel: "Tín hiệu",
                    title: "Bảng vận hành tín hiệu",
                    description: "Tạo, nhập, xem và quản lý các lần chạy tín hiệu từ cùng chart-first workspace.",
                },
                reports: {
                    moduleLabel: "Báo cáo",
                    title: "Bảng báo cáo giải thích",
                    description: "Xem câu chuyện confidence, dấu vết bằng chứng và xuất artifact xác thực với ngữ cảnh run được giữ nguyên.",
                },
                trading: {
                    moduleLabel: "Giao dịch",
                    title: "Bảng điều khiển giao dịch runtime",
                    description: "Đánh giá live-readiness có guardrail, capability tier và ranh giới vận hành mà không rời shared shell.",
                },
                engine: {
                    moduleLabel: "Bộ máy",
                    title: "Bảng phân tích và runtime",
                    description: "Xem phân tích bộ máy, đầu ra giám sát và các phân rã điều tra trong cùng một khung vận hành.",
                },
                indicators: {
                    moduleLabel: "Chỉ báo",
                    title: "Bảng vận hành chỉ báo",
                    description: "Xem trạng thái runtime của chỉ báo, cảnh báo và tín hiệu chẩn đoán trong analytical command shell.",
                },
                chart: {
                    moduleLabel: "Biểu đồ",
                    title: "Bảng ngữ cảnh biểu đồ",
                    description: "Giữ mã, timeframe, độ tươi dữ liệu và ngữ cảnh kiểm tra luôn hiển thị trong khi phân tích biểu đồ vẫn là không gian chính.",
                },
            },
        },
        topNav: {
            searchPlaceholder: "Tìm mã thị trường...",
            clearSymbolSearch: "Xóa tìm kiếm mã",
            symbolContext: "Ngữ cảnh mã",
            noSymbolsFound: "Không tìm thấy mã khớp \"{{search}}\"",
            marketSource: "Thị trường",
            mt5Source: "MT5",
        },
        timeframeSwitcher: {
            ariaLabel: "Chọn khung thời gian",
        },
        login: {
            authenticatedLogin: "Đăng nhập xác thực",
            title: "Đăng nhập để mở các workspace giao dịch đã được cấp cho bạn.",
            description: "Tài khoản quản trị có thể quản lý người dùng và toàn bộ module. Người dùng thường chỉ vào được các module mà quản trị đã cấp qua chart, signal, report, trading và engine.",
            adminLane: "Luồng quản trị",
            adminLaneTitle: "Quản lý người dùng + toàn hệ thống",
            adminLaneDescription: "Tạo tài khoản, bật module, vô hiệu người dùng và truy cập mọi route được bảo vệ.",
            userLane: "Luồng người dùng",
            userLaneTitle: "Truy cập theo phạm vi module",
            userLaneDescription: "Route được phép đầu tiên sẽ là điểm đến sau đăng nhập, còn các module bị chặn sẽ tiếp tục bị ẩn và bảo vệ.",
            sessionGate: "Cổng phiên",
            emailOrUsername: "Email hoặc tên đăng nhập",
            emailOrUsernamePlaceholder: "admin hoặc admin@tvgit.local",
            password: "Mật khẩu",
            passwordPlaceholder: "Nhập mật khẩu của bạn",
            signIn: "Đăng nhập",
            signInFallbackError: "Không thể đăng nhập.",
        },
        watchlist: {
            title: "Danh sách theo dõi",
            description: "Giữ ngữ cảnh thị trường luôn hiển thị mà không rời workspace hiện tại.",
            empty: "Không tìm thấy mã nào.",
            volumePrefix: "KL",
        },
        syncStatus: {
            candles: "nến",
            oldestData: "Dữ liệu sớm nhất",
            latestData: "Dữ liệu mới nhất",
            unavailable: "--/--/---- --:--",
        },
        indicatorCatalog: {
            title: "Danh mục chỉ báo",
            subtitle: "Bấm vào điều kiện để thêm vào khung soạn thảo",
            categories: {
                momentum: "Động lượng",
                trend: "Xu hướng",
                structure: "Cấu trúc",
                volatility: "Biến động",
                fibonacci: "Fibonacci",
                utility: "Tiện ích",
                other: "Khác",
            },
        },
        compositionCanvas: {
            matchMode: {
                ALL: "ALL - mọi điều kiện phải khớp trong cùng một cửa sổ",
                ANY: "ANY - chỉ cần ít nhất một điều kiện khớp",
                SEQUENCE: "SEQUENCE - các điều kiện phải khớp theo đúng thứ tự",
            },
            windowLabel: "cửa sổ",
            barsLabel: "nến",
            emptyPrompt: "Chọn một điều kiện từ danh mục bên trái để thêm vào đây.",
            sequenceHint: "Thứ tự bên dưới là chuỗi điều kiện phải khớp.",
            then: "sau đó",
            editParameters: "Chỉnh tham số",
            indicatorParams: "Tham số chỉ báo",
            conditionParams: "Tham số điều kiện",
        },
        notification: {
            smartAlertTriggered: "Cảnh báo thông minh vừa kích hoạt",
            live: "TRỰC TIẾP",
        },
        accessGate: {
            accessControl: "Kiểm soát truy cập",
            restoringSession: "Đang khôi phục phiên",
            validatingSession: "Đang xác thực phiên...",
            redirectingToSignIn: "Đang chuyển hướng đăng nhập",
            redirectingMessage: "Các module được bảo vệ yêu cầu phiên xác thực. Đang chuyển hướng đến /login.",
            adminAccessRequired: "Yêu cầu quyền quản trị",
            adminAccessRequiredMessage: "Yêu cầu quyền quản trị.",
            openAllowedWorkspace: "Mở workspace được phép",
            moduleAccessNotEnabled: "Quyền truy cập {{modules}} chưa được kích hoạt cho tài khoản này",
            moduleGatedMessage: "Phiên hiện tại đang hoạt động, nhưng route này yêu cầu quyền module {{modules}}. Liên hệ quản trị viên để cập nhật quyền hoặc tiếp tục trong workspace được phép.",
        },
        alertConfig: {
            configureSmartAlert: "Cấu hình cảnh báo thông minh",
            alertType: "Loại cảnh báo",
            priceAction: "Hành động giá",
            signalMatrix: "Ma trận tín hiệu",
            greaterThanOrEqual: "Lớn hơn hoặc bằng",
            lessThanOrEqual: "Nhỏ hơn hoặc bằng",
            targetPrice: "Giá mục tiêu",
            notifyPriceCross: "Thông báo khi giá {{symbol}} vượt qua mức này.",
            selectSignalEvent: "Chọn sự kiện tín hiệu",
            entryPrimary: "ENTRY (Tín hiệu chính)",
            entryConfirmedStrict: "ENTRY_CONFIRMED (Nghiêm ngặt)",
            tp1HitSuccess: "TP1 HIT (Thành công)",
            stopHitFailure: "STOP HIT (Lỗi/Thất bại)",
            notifyEngineEvent: "Thông báo khi {{name}} tạo sự kiện engine này.",
            cancel: "Hủy",
            saving: "Đang lưu...",
            activateAlert: "Kích hoạt cảnh báo",
        },
        gettingStarted: {
            getStarted: "Bắt đầu",
            complete: "hoàn thành",
            mt5Connected: "Tài khoản MT5 đã kết nối",
            connect: "Kết nối",
            backtestCompleted: "Backtest hoàn thành",
            runBacktests: "Chạy backtest",
            liveEligibleSignal: "Tín hiệu đủ điều kiện live",
            viewSignals: "Xem tín hiệu",
            paperTradingActive: "Paper trading đang hoạt động",
            setUp: "Thiết lập",
            ariaLabel: "Bắt đầu với paper trading",
            dismiss: "Ẩn danh sách bắt đầu",
        },
        indicatorSettings: {
            advancedSettings: "Cài đặt nâng cao",
            strategyParameters: "Tham số chiến lược",
            jsonConfig: "Cấu hình JSON",
            syntaxError: "Lỗi cú pháp: {{error}}",
            capabilities: "Khả năng",
            riskGuard: "Bảo vệ rủi ro",
            enabledInCode: "Bật trong code",
            liveExecution: "Thực thi trực tiếp",
            manualApproval: "Phê duyệt thủ công",
            reset: "Đặt lại",
            saveParameters: "Lưu tham số",
        },
        indicatorLogs: {
            liveExecutionLogs: "Nhật ký thực thi trực tiếp",
            autoScroll: "Cuộn tự động",
            clear: "Xóa",
            waitingForExecution: "Đang chờ thực thi chỉ báo...",
        },
        signalReview: {
            signalReview: "Xem xét tín hiệu",
            runBacktest: "Chạy Backtest",
            reuseAsNew: "Tái sử dụng",
            retiredSnapshot: "Bản sao đã ngừng",
            reopen: "Mở lại",
            retireSignalAria: "Ngừng tín hiệu",
            retiring: "Đang ngừng...",
            retire: "Ngừng",
            inheritedFromRuntime: "Kế thừa từ runtime",
            lifecycle: "Vòng đời",
            lineage: "Phả hệ",
            derivedFrom: "Kế thừa từ",
            inspectOriginal: "Kiểm tra gốc",
            refinements: "Tinh chỉnh",
            inspect: "Kiểm tra",
            ruleStructure: "Cấu trúc quy tắc",
            signalContext: "Ngữ cảnh tín hiệu",
            direction: "Hướng",
            conditions: "Điều kiện",
            connector: "Kết nối",
            tradePlan: "Kế hoạch giao dịch",
            entry: "Vào lệnh",
            protection: "Bảo vệ",
            exit: "Thoát lệnh",
            conditionFlow: "Luồng điều kiện",
            catalogDefaults: "Sử dụng mặc định của danh mục cho block này.",
            closeSignalReview: "Đóng xem xét tín hiệu",
        },
        tradingReadiness: {
            title: "Sẵn sàng thông tin tài khoản & kết nối",
            description: "Kiểm tra tài khoản MT5 đang hoạt động, hoặc tài khoản đã lưu được chọn trong Thiết lập tài khoản, xác minh hỗ trợ mã hóa và xác nhận bridge có thể kết nối cho quy trình trading-read.",
            refresh: "Làm mới",
            tradingReadBlocked: "Trading read vẫn bị chặn runtime",
            mt5SetupReadNeeded: "MT5 đã sẵn sàng. Các surface khác cần read tier.",
            evaluatingReadiness: "Đang đánh giá sẵn sàng tài khoản...",
            readinessCheckFailed: "Kiểm tra sẵn sàng thất bại",
            account: "Tài khoản",
            mode: "Chế độ",
            mt5Login: "MT5 Login",
            mt5Server: "MT5 Server",
            bridgePort: "Cổng Bridge",
            readinessChecks: "Kiểm tra sẵn sàng",
            blockingReasons: "Lý do chặn",
            readyToActivate: "Tài khoản MT5 đã lưu và hạ tầng kết nối đã được xác nhận. Các đánh giá trading-read có thể dựa vào ngữ cảnh broker này khi cổng read runtime được kích hoạt.",
        },
        tradingConnection: {
            mt5AccountSetup: "Thiết lập tài khoản MT5",
            manageAccounts: "Quản lý tài khoản MT5",
            refresh: "Làm mới",
            addAccount: "Thêm tài khoản",
            connectionSetupAvailable: "Thiết lập kết nối có sẵn trước khi trading read được bật",
            mt5SetupReadNeeded: "MT5 đã sẵn sàng. Cần read tier để tiếp tục.",
            accountOwnerScope: "Phạm vi chủ tài khoản",
            adminDefaultsPersonal: "Quản trị mặc định dùng tài khoản MT5 cá nhân cho đến khi chọn người dùng khác.",
            chooseUserInspect: "Chỉ chọn người dùng khi bạn cần kiểm tra hoặc quản lý tài khoản MT5 đã lưu của họ.",
            viewingAccountsFor: "Đang xem tài khoản của",
            myAccounts: "Tài khoản của tôi ({{name}})",
            currentScope: "Phạm vi hiện tại:",
            loadingSetup: "Đang tải thiết lập tài khoản MT5...",
            requestFailed: "Yêu cầu tài khoản MT5 thất bại",
            savedAccounts: "Tài khoản đã lưu",
            accountCount: "{{count}} tài khoản {{scope}}.",
            active: "Đang hoạt động: {{label}}",
            noAccountSaved: "Chưa có tài khoản MT5 nào được lưu. Thêm tài khoản đầu tiên để tạo kết nối broker mã hóa cho {{scope}}.",
            createNewAccount: "Tạo tài khoản mới",
            selectedAccount: "Tài khoản đã chọn",
            newMt5Account: "Tài khoản MT5 mới",
            chooseAnAccount: "Chọn tài khoản",
            addAnotherAccount: "Thêm tài khoản MT5 khác mà không thay thế tài khoản đang hoạt động.",
            editSelectedAccount: "Chỉnh sửa tài khoản đã chọn, hoặc đặt làm tài khoản Trading hoạt động.",
            selectOrAdd: "Chọn tài khoản hiện có hoặc thêm mới.",
            edit: "Sửa",
            currentlyActive: "Đang hoạt động",
            setActive: "Đặt hoạt động",
            delete: "Xóa",
            accountLabel: "Nhãn tài khoản",
            tradingMode: "Chế độ giao dịch",
            paperDemo: "Paper / Demo",
            paperDemoDescription: "Dùng thông tin MT5 demo để diễn tập ghi và tự động hóa mà không dùng vốn thật.",
            live: "Live",
            liveDescription: "Dùng thông tin broker production và giữ thông báo trách nhiệm cao hơn trong Trading.",
            paperModeHelper: "Tài khoản paper nên dùng thông tin MT5 demo để toàn bộ luồng ghi và tự động hóa không phải live.",
            liveModeHelper: "Tài khoản live giữ hành vi thực thi MT5 hiện tại và chỉ nên dùng khi ngữ cảnh broker đã sẵn sàng production.",
            mt5Login: "MT5 login",
            mt5Server: "MT5 server",
            mt5Password: "Mật khẩu MT5",
            passwordKeepBlank: "Để trống mật khẩu MT5 để giữ secret đã lưu.",
            passwordEncrypted: "Mật khẩu được mã hóa lưu trên backend với ENCRYPTION_KEY.",
            saveNewAccount: "Lưu tài khoản mới",
            saveAccountChanges: "Lưu thay đổi tài khoản",
            createAccount: "Tạo tài khoản",
            cancelNewAccount: "Hủy tài khoản mới",
            accountLabelRequired: "Nhãn tài khoản là bắt buộc.",
            mt5LoginRequired: "MT5 login là bắt buộc.",
            mt5ServerRequired: "MT5 server là bắt buộc.",
            mt5PasswordRequired: "Mật khẩu MT5 là bắt buộc cho kết nối mới.",
            serverDemoModeLive: "Tên MT5 server gợi ý môi trường demo, nhưng chế độ tài khoản đang là Live. Kiểm tra lại trước khi lưu.",
            serverNotDemoModePaper: "Tên MT5 server không giống demo server, nhưng chế độ tài khoản đang là Paper. Xác nhận thông tin đúng ý định của bạn.",
            unableToLoadUsers: "Không thể tải danh sách người dùng quản lý.",
        },
        paperWizard: {
            startPaperTrading: "Bắt đầu Paper Trading",
            account: "Tài khoản",
            risk: "Rủi ro",
            review: "Xem xét",
            loadingAccounts: "Đang tải tài khoản...",
            noPaperAccountFound: "Không tìm thấy tài khoản MT5 paper",
            connectPaperFirst: "Kết nối tài khoản MT5 paper/demo trước khi thiết lập paper trading.",
            goToAccountSettings: "Đi đến cài đặt tài khoản →",
            paperAccount: "Tài khoản paper",
            autoSelected: "Đã tự chọn. Thêm tài khoản paper khác nếu cần.",
            selectPaperAccount: "Chọn tài khoản paper",
            riskPerTrade: "Rủi ro mỗi lệnh",
            maxOpenPositions: "Số vị thế mở tối đa",
            autoCalculatedGuardrails: "Rào chắn tự động tính",
            dailyLossCap: "Giới hạn lỗ hàng ngày",
            killSwitchDrawdown: "Kill switch drawdown",
            signal: "Tín hiệu",
            riskConfig: "Cấu hình rủi ro",
            riskTrade: "Rủi ro/lệnh",
            maxPositions: "Vị thế tối đa",
            dailyCap: "Giới hạn ngày",
            killSwitch: "Kill switch",
            setupFailed: "Thiết lập thất bại: ",
            activating: "Đang kích hoạt...",
            approveAndActivate: "Phê duyệt & Kích hoạt",
            paperTradingActive: "Paper trading đang hoạt động",
            signalRunningPaper: "{{name}} đang chạy ở chế độ paper.",
            monitorAutomation: "Theo dõi trong tab Tự động hóa.",
            back: "Quay lại",
            next: "Tiếp theo",
            backToRiskConfig: "← Quay lại cấu hình rủi ro",
            approveActivateAria: "Phê duyệt và kích hoạt paper trading",
            closeWizard: "Đóng wizard",
        },
        chartStatus: {
            candles: "nến",
            lastUpdated: "Cập nhật lần cuối:",
        },
        errorBoundary: {
            somethingWentWrong: "Đã xảy ra lỗi",
            failedToRender: "Không thể hiển thị component này.",
            tryAgain: "Thử lại",
        },
        modulePlaceholder: {
            openEngine: "Mở Engine",
        },
    },
} satisfies Record<AppLocale, TranslationCatalog>;

export function getTranslationCatalog(locale: AppLocale): TranslationCatalog {
    return translations[locale] ?? translations[DEFAULT_APP_LOCALE];
}

export function interpolateCopy(template: string, values: Record<string, string | number>): string {
    return Object.entries(values).reduce(
        (result, [key, value]) => result.replaceAll(`{{${key}}}`, String(value)),
        template,
    );
}

export function flattenTranslationEntries(
    value: TranslationCatalog | Record<string, unknown>,
    prefix = "",
): string[] {
    const entries: string[] = [];

    for (const [key, nested] of Object.entries(value)) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (typeof nested === "string") {
            entries.push(path);
            continue;
        }

        if (nested && typeof nested === "object" && !Array.isArray(nested)) {
            entries.push(...flattenTranslationEntries(nested as Record<string, unknown>, path));
        }
    }

    return entries.sort();
}

export function collectTranslationLeafValues(
    value: TranslationCatalog | Record<string, unknown>,
): string[] {
    const leaves: string[] = [];

    for (const nested of Object.values(value)) {
        if (typeof nested === "string") {
            leaves.push(nested);
            continue;
        }

        if (nested && typeof nested === "object" && !Array.isArray(nested)) {
            leaves.push(...collectTranslationLeafValues(nested as Record<string, unknown>));
        }
    }

    return leaves;
}
