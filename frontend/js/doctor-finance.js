document.addEventListener("DOMContentLoaded", () => {
    const userRaw = localStorage.getItem("hm_user");

    if (!userRaw) {
        return;
    }

    const user = JSON.parse(userRaw);

    if (user.role !== "doctor") {
        return;
    }

    const doctorDashboard = document.getElementById("doctorDashboard");

    if (!doctorDashboard) {
        return;
    }

    const tabContainer = doctorDashboard.querySelector(".doctor-module-tabs");

    if (!tabContainer) {
        return;
    }

    const isLocalFrontend =
        window.location.hostname === "127.0.0.1" ||
        window.location.hostname === "localhost" ||
        window.location.protocol === "file:";

    const API_BASE_URL = isLocalFrontend
        ? window.HM_CONFIG.LOCAL_API_URL
        : window.HM_CONFIG.PRODUCTION_API_URL;

    const tabButton = document.createElement("button");
    tabButton.className = "doctor-module-tab";
    tabButton.type = "button";
    tabButton.setAttribute("data-doctor-tab", "doctorFinanceTab");
    tabButton.textContent = "Finance";

    tabContainer.appendChild(tabButton);

    const panel = document.createElement("section");
    panel.id = "doctorFinanceTab";
    panel.className = "doctor-module-panel hidden";

    panel.innerHTML = `
        <div class="dashboard-header">
            <div>
                <h2>Financial Tracking</h2>
                <p>Track paid, pending, waived, and net collected consultation fees.</p>
            </div>

            <button id="refreshDoctorFinanceButton" class="secondary-button" type="button">
                Refresh Finance
            </button>
        </div>

        <div id="doctorFinanceMessage" class="form-result"></div>

        <div class="finance-filter-grid">
            <div>
                <label>Date From</label>
                <input id="doctorFinanceDateFrom" type="date">
            </div>

            <div>
                <label>Date To</label>
                <input id="doctorFinanceDateTo" type="date">
            </div>

            <div>
                <label>Hospital</label>
                <select id="doctorFinanceHospital">
                    <option value="">All hospitals</option>
                </select>
            </div>

            <div>
                <label>PA</label>
                <select id="doctorFinancePa">
                    <option value="">All PAs</option>
                </select>
            </div>
        </div>

        <div id="financeSummaryCards" class="finance-summary-grid"></div>

        <div class="finance-breakdown-grid">
            <div class="settings-list-card">
                <h3>Revenue by Hospital</h3>
                <div id="financeByHospitalList" class="compact-list"></div>
            </div>

            <div class="settings-list-card">
                <h3>Revenue by PA</h3>
                <div id="financeByPaList" class="compact-list"></div>
            </div>

            <div class="settings-list-card">
                <h3>Revenue by Source</h3>
                <div id="financeBySourceList" class="compact-list"></div>
            </div>

            <div class="settings-list-card">
                <h3>Daily Revenue</h3>
                <div id="financeByDayList" class="compact-list scroll-list"></div>
            </div>

            <div class="settings-list-card finance-wide-card">
                <h3>Pending Fee Appointments</h3>
                <div id="financePendingList" class="compact-list scroll-list"></div>
            </div>
        </div>
    `;

    doctorDashboard.appendChild(panel);

    const messageBox = document.getElementById("doctorFinanceMessage");
    const refreshButton = document.getElementById("refreshDoctorFinanceButton");
    const dateFromInput = document.getElementById("doctorFinanceDateFrom");
    const dateToInput = document.getElementById("doctorFinanceDateTo");
    const hospitalSelect = document.getElementById("doctorFinanceHospital");
    const paSelect = document.getElementById("doctorFinancePa");

    const summaryCards = document.getElementById("financeSummaryCards");
    const byHospitalList = document.getElementById("financeByHospitalList");
    const byPaList = document.getElementById("financeByPaList");
    const bySourceList = document.getElementById("financeBySourceList");
    const byDayList = document.getElementById("financeByDayList");
    const pendingList = document.getElementById("financePendingList");

    function showMessage(message, type) {
        messageBox.textContent = message;
        messageBox.classList.remove("ok", "error", "pending");

        if (type) {
            messageBox.classList.add(type);
        }
    }

    function localDateString(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");

        return `${year}-${month}-${day}`;
    }

    function setDefaultDates() {
        const now = new Date();
        const from = new Date();
        const to = new Date();

        from.setDate(now.getDate() - 30);
        to.setDate(now.getDate());

        dateFromInput.value = localDateString(from);
        dateToInput.value = localDateString(to);
    }

    function money(value) {
        const number = Number(value || 0);
        return `Rs. ${number.toLocaleString()}`;
    }

    function formatDate(value) {
        if (!value) {
            return "N/A";
        }

        const date = new Date(value);

        return date.toLocaleDateString([], {
            year: "numeric",
            month: "short",
            day: "2-digit"
        });
    }

    function formatDateTime(value) {
        if (!value) {
            return "N/A";
        }

        const date = new Date(value);

        return date.toLocaleString([], {
            year: "numeric",
            month: "short",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit"
        });
    }

    async function apiRequest(path, options = {}) {
        const token = localStorage.getItem("hm_token");

        if (!token) {
            window.location.href = "./index.html";
            throw new Error("Login session expired.");
        }

        const headers = {
            ...(options.headers || {}),
            "Authorization": `Bearer ${token}`
        };

        const response = await fetch(`${API_BASE_URL}${path}`, {
            ...options,
            headers
        });

        const result = await response.json();

        if (!response.ok) {
            console.log("DOCTOR_FINANCE_API_ERROR:", result);
            throw new Error(result.error || result.message || "Request failed.");
        }

        return result;
    }

    function switchToFinanceTab() {
        doctorDashboard.querySelectorAll(".doctor-module-tab").forEach((tab) => {
            tab.classList.remove("active");
        });

        doctorDashboard.querySelectorAll(".doctor-module-panel").forEach((panelItem) => {
            panelItem.classList.add("hidden");
        });

        tabButton.classList.add("active");
        panel.classList.remove("hidden");

        initializeFinance();
    }

    function hideIfOtherTabClicked(event) {
        const clickedTab = event.target.closest(".doctor-module-tab");

        if (!clickedTab) {
            return;
        }

        if (clickedTab.getAttribute("data-doctor-tab") !== "doctorFinanceTab") {
            tabButton.classList.remove("active");
            panel.classList.add("hidden");
        }
    }

    async function loadFilters() {
        const result = await apiRequest("/api/doctor/appointments/filters");

        const hospitals = result.data.hospitals || [];
        const pas = result.data.pas || [];

        hospitalSelect.innerHTML =
            `<option value="">All hospitals</option>` +
            hospitals.map((hospital) => {
                return `
                    <option value="${hospital.id}">
                        ${hospital.name} - ${hospital.city || ""}
                    </option>
                `;
            }).join("");

        paSelect.innerHTML =
            `<option value="">All PAs</option>` +
            pas.map((pa) => {
                return `
                    <option value="${pa.pa_id}">
                        ${pa.full_name || pa.email || "Unnamed PA"} - ${pa.hospital_name}
                    </option>
                `;
            }).join("");
    }

    function buildQuery() {
        const params = new URLSearchParams();

        params.set("date_from", dateFromInput.value);
        params.set("date_to", dateToInput.value);

        if (hospitalSelect.value) {
            params.set("doctor_hospital_id", hospitalSelect.value);
        }

        if (paSelect.value) {
            params.set("pa_id", paSelect.value);
        }

        return params.toString();
    }

    async function loadFinance() {
        try {
            showMessage("Loading finance summary...", "pending");

            const result = await apiRequest(`/api/doctor/finance/summary?${buildQuery()}`);

            renderFinance(result.data);

            showMessage("Finance summary loaded.", "ok");
        } catch (error) {
            showMessage(error.message, "error");
        }
    }

    function renderFinance(data) {
        renderSummaryCards(data.summary || {});
        renderHospitalBreakdown(data.by_hospital || []);
        renderPaBreakdown(data.by_pa || []);
        renderSourceBreakdown(data.by_source || []);
        renderDayBreakdown(data.by_day || []);
        renderPendingAppointments(data.pending_appointments || []);
    }

    function renderSummaryCards(summary) {
        const cards = [
            {
                label: "Paid Revenue",
                value: money(summary.paid_amount)
            },
            {
                label: "Pending Amount",
                value: money(summary.pending_amount)
            },
            {
                label: "Waived Amount",
                value: money(summary.waived_amount)
            },
            {
                label: "Net Collected",
                value: money(summary.net_collected_amount)
            },
            {
                label: "Total Appointments",
                value: summary.total_appointments || 0
            },
            {
                label: "Completed",
                value: summary.completed_appointments || 0
            },
            {
                label: "Paid Appointments",
                value: summary.paid_appointments || 0
            },
            {
                label: "Pending Fee Cases",
                value: summary.pending_fee_appointments || 0
            },
            {
                label: "Discounts",
                value: money(summary.discount_amount)
            },
            {
                label: "Refunds",
                value: money(summary.refund_amount)
            }
        ];

        summaryCards.innerHTML = cards.map((card) => {
            return `
                <div class="finance-card">
                    <span>${card.label}</span>
                    <strong>${card.value}</strong>
                </div>
            `;
        }).join("");
    }

    function renderHospitalBreakdown(items) {
        if (!items.length) {
            byHospitalList.innerHTML = `<p class="muted-text">No hospital revenue found.</p>`;
            return;
        }

        byHospitalList.innerHTML = items.map((item) => {
            return `
                <div class="compact-item">
                    <strong>${item.hospital_name} - ${item.hospital_city || ""}</strong>
                    <span>Appointments: ${item.appointment_count}</span>
                    <span>Paid: ${money(item.paid_amount)}</span>
                    <span>Pending: ${money(item.pending_amount)}</span>
                </div>
            `;
        }).join("");
    }

    function renderPaBreakdown(items) {
        if (!items.length) {
            byPaList.innerHTML = `<p class="muted-text">No PA revenue found.</p>`;
            return;
        }

        byPaList.innerHTML = items.map((item) => {
            return `
                <div class="compact-item">
                    <strong>${item.pa_name || "No PA"}</strong>
                    <span>Appointments: ${item.appointment_count}</span>
                    <span>Paid: ${money(item.paid_amount)}</span>
                    <span>Pending: ${money(item.pending_amount)}</span>
                </div>
            `;
        }).join("");
    }

    function renderSourceBreakdown(items) {
        if (!items.length) {
            bySourceList.innerHTML = `<p class="muted-text">No source revenue found.</p>`;
            return;
        }

        bySourceList.innerHTML = items.map((item) => {
            return `
                <div class="compact-item">
                    <strong>${item.source}</strong>
                    <span>Appointments: ${item.appointment_count}</span>
                    <span>Paid: ${money(item.paid_amount)}</span>
                    <span>Pending: ${money(item.pending_amount)}</span>
                </div>
            `;
        }).join("");
    }

    function renderDayBreakdown(items) {
        if (!items.length) {
            byDayList.innerHTML = `<p class="muted-text">No daily revenue found.</p>`;
            return;
        }

        byDayList.innerHTML = items.map((item) => {
            return `
                <div class="compact-item">
                    <strong>${formatDate(item.appointment_date)}</strong>
                    <span>Appointments: ${item.appointment_count}</span>
                    <span>Paid: ${money(item.paid_amount)}</span>
                    <span>Pending: ${money(item.pending_amount)}</span>
                </div>
            `;
        }).join("");
    }

    function renderPendingAppointments(items) {
        if (!items.length) {
            pendingList.innerHTML = `<p class="muted-text">No pending fee appointments found.</p>`;
            return;
        }

        pendingList.innerHTML = items.map((item) => {
            return `
                <div class="compact-item">
                    <strong>${item.patient_name}</strong>
                    <span>CNIC: ${item.patient_cnic}</span>
                    <span>Time: ${formatDateTime(item.appointment_datetime)}</span>
                    <span>Hospital: ${item.hospital_name} - ${item.hospital_city || ""}</span>
                    <span>PA: ${item.pa_name || "N/A"}</span>
                    <span>Fee: ${money(item.fee_charged)}</span>
                    <span>Status: ${item.status}</span>
                    <span>Source: ${item.source}</span>
                </div>
            `;
        }).join("");
    }

    let initialized = false;

    async function initializeFinance() {
        try {
            if (!initialized) {
                setDefaultDates();
                await loadFilters();
                initialized = true;
            }

            await loadFinance();
        } catch (error) {
            showMessage(error.message, "error");
        }
    }

    tabButton.addEventListener("click", switchToFinanceTab);
    tabContainer.addEventListener("click", hideIfOtherTabClicked);
    refreshButton.addEventListener("click", loadFinance);

    [
        dateFromInput,
        dateToInput,
        hospitalSelect,
        paSelect
    ].forEach((element) => {
        element.addEventListener("change", loadFinance);
    });
});