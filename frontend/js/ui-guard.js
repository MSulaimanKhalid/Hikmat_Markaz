document.addEventListener("DOMContentLoaded", () => {
    const refreshCooldown = {};

    function safeClickButton(buttonId) {
        const button = document.getElementById(buttonId);

        if (!button) {
            return false;
        }

        if (button.disabled) {
            return false;
        }

        const now = Date.now();

        if (refreshCooldown[buttonId] && now - refreshCooldown[buttonId] < 900) {
            return true;
        }

        refreshCooldown[buttonId] = now;

        setTimeout(() => {
            try {
                button.click();
            } catch (error) {
                console.log("REFRESH_BUTTON_CLICK_ERROR:", buttonId, error.message);
            }
        }, 80);

        return true;
    }

    function triggerPanelDataLoad(panelId) {
        const refreshMap = {
            adminPendingDoctorsTab: [
                "refreshAdminDashboardButton",
                "refreshAdminButton"
            ],

            adminAllDoctorsTab: [
                "refreshAdminDashboardButton",
                "refreshAdminButton"
            ],

            doctorSettingsTab: [
                "refreshDoctorDashboardButton",
                "refreshDoctorSettingsButton"
            ],

            doctorPaTab: [
                "refreshDoctorDashboardButton",
                "refreshPaDataButton",
                "refreshDoctorSettingsButton"
            ],

            doctorQueueTab: [
                "refreshDoctorQueueButton",
                "refreshQueueButton"
            ],

            doctorAppointmentsTab: [
                "refreshDoctorAppointmentsButton"
            ],

            doctorFinanceTab: [
                "refreshDoctorFinanceButton"
            ],

            paAssignmentsTab: [
                "refreshPaDashboardButton",
                "refreshPaWorkspaceButton"
            ],

            paBookAppointmentTab: [
                "refreshPaDashboardButton",
                "refreshPaWorkspaceButton"
            ],

            paAppointmentsTab: [
                "refreshPaDashboardButton",
                "refreshPaWorkspaceButton",
                "refreshPaAppointmentsButton"
            ],

            paPaymentsTab: [
                "refreshPaPaymentsButton"
            ],

            paOnlineRequestsTab: [
                "refreshPaOnlineRequestsButton",
                "refreshOnlineRequestsButton"
            ],

            patientAppointmentsTab: [
                "refreshPatientPortalButton",
                "refreshPatientAppointmentsButton"
            ],

            patientPrescriptionsTab: [
                "refreshPatientPortalButton",
                "refreshPatientPrescriptionsButton"
            ],

            patientRequestAppointmentTab: [
                "refreshPatientPortalButton",
                "refreshPatientDoctorsButton",
                "loadPatientDoctorsButton"
            ]
        };

        const buttons = refreshMap[panelId] || [];

        let clickedAny = false;

        buttons.forEach((buttonId) => {
            if (safeClickButton(buttonId)) {
                clickedAny = true;
            }
        });

        const panel = document.getElementById(panelId);

        if (!clickedAny && panel) {
            const localRefreshButton = Array.from(panel.querySelectorAll("button")).find((button) => {
                const id = (button.id || "").toLowerCase();
                const text = (button.textContent || "").toLowerCase();

                return (
                    id.includes("refresh") ||
                    text.includes("refresh") ||
                    text.includes("load")
                );
            });

            if (localRefreshButton) {
                try {
                    localRefreshButton.click();
                    clickedAny = true;
                } catch (error) {
                    console.log("LOCAL_PANEL_REFRESH_ERROR:", panelId, error.message);
                }
            }
        }

        window.dispatchEvent(new CustomEvent("hm:tab-opened", {
            detail: {
                panelId,
                clickedAny
            }
        }));
    }

    function activateTab(root, tab, tabSelector, panelSelector, attributeName) {
        if (!root || !tab) {
            return;
        }

        const targetId = tab.getAttribute(attributeName);

        if (!targetId) {
            return;
        }

        const targetPanel = document.getElementById(targetId);

        if (!targetPanel) {
            console.log("TAB_TARGET_PANEL_NOT_FOUND:", targetId);
            return;
        }

        root.querySelectorAll(tabSelector).forEach((item) => {
            item.classList.remove("active");
        });

        root.querySelectorAll(panelSelector).forEach((panel) => {
            panel.classList.add("hidden");
        });

        tab.classList.add("active");
        targetPanel.classList.remove("hidden");

        triggerPanelDataLoad(targetId);
    }

    function getVisibleDashboardRoot() {
        const roots = [
            document.getElementById("adminDashboard"),
            document.getElementById("doctorDashboard"),
            document.getElementById("paDashboard"),
            document.getElementById("patientDashboard")
        ];

        return roots.find((root) => {
            return root && !root.classList.contains("hidden");
        });
    }

    function triggerInitialDashboardLoad() {
        const root = getVisibleDashboardRoot();

        if (!root) {
            return;
        }

        const activeTab =
            root.querySelector(".admin-module-tab.active") ||
            root.querySelector(".doctor-module-tab.active") ||
            root.querySelector(".pa-module-tab.active") ||
            root.querySelector(".patient-module-tab.active") ||
            root.querySelector(".tab-button.active");

        if (activeTab) {
            const panelId =
                activeTab.getAttribute("data-admin-tab") ||
                activeTab.getAttribute("data-doctor-tab") ||
                activeTab.getAttribute("data-pa-tab") ||
                activeTab.getAttribute("data-patient-tab");

            if (panelId) {
                triggerPanelDataLoad(panelId);
                return;
            }
        }

        const genericRefreshButton = Array.from(root.querySelectorAll("button")).find((button) => {
            const id = (button.id || "").toLowerCase();
            const text = (button.textContent || "").toLowerCase();

            return (
                id.includes("refresh") ||
                text.includes("refresh")
            );
        });

        if (genericRefreshButton) {
            try {
                genericRefreshButton.click();
            } catch (error) {
                console.log("GENERIC_INITIAL_REFRESH_ERROR:", error.message);
            }
        }
    }

    document.addEventListener("click", (event) => {
        const doctorTab = event.target.closest("[data-doctor-tab]");
        const paTab = event.target.closest("[data-pa-tab]");
        const adminTab = event.target.closest("[data-admin-tab]");
        const patientTab = event.target.closest("[data-patient-tab]");

        if (doctorTab) {
            event.preventDefault();

            activateTab(
                doctorTab.closest("#doctorDashboard"),
                doctorTab,
                "[data-doctor-tab]",
                ".doctor-module-panel",
                "data-doctor-tab"
            );

            return;
        }

        if (paTab) {
            event.preventDefault();

            activateTab(
                paTab.closest("#paDashboard"),
                paTab,
                "[data-pa-tab]",
                ".pa-module-panel",
                "data-pa-tab"
            );

            return;
        }

        if (adminTab) {
            event.preventDefault();

            activateTab(
                adminTab.closest("#adminDashboard"),
                adminTab,
                "[data-admin-tab]",
                ".admin-module-panel",
                "data-admin-tab"
            );

            return;
        }

        if (patientTab) {
            event.preventDefault();

            activateTab(
                patientTab.closest("#patientDashboard"),
                patientTab,
                "[data-patient-tab]",
                ".patient-module-panel",
                "data-patient-tab"
            );
        }
    });

    document.querySelectorAll(
        ".doctor-module-tab, .pa-module-tab, .admin-module-tab, .patient-module-tab, .tab-button"
    ).forEach((button) => {
        button.setAttribute("type", "button");
        button.style.pointerEvents = "auto";
        button.style.cursor = "pointer";
    });

    setTimeout(triggerInitialDashboardLoad, 600);
    setTimeout(triggerInitialDashboardLoad, 1600);
    setTimeout(triggerInitialDashboardLoad, 3000);

    window.HM_TRIGGER_PANEL_LOAD = triggerPanelDataLoad;
});