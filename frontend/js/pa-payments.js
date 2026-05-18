document.addEventListener("DOMContentLoaded", () => {
    const userRaw = localStorage.getItem("hm_user");

    if (!userRaw) {
        return;
    }

    const user = JSON.parse(userRaw);

    if (user.role !== "pa") {
        return;
    }

    const paDashboard = document.getElementById("paDashboard");

    if (!paDashboard) {
        return;
    }

    const tabContainer = paDashboard.querySelector(".doctor-module-tabs");

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
    tabButton.className = "pa-module-tab";
    tabButton.type = "button";
    tabButton.setAttribute("data-pa-tab", "paPaymentsTab");
    tabButton.textContent = "Payments";

    tabContainer.appendChild(tabButton);

    const panel = document.createElement("section");
    panel.id = "paPaymentsTab";
    panel.className = "pa-module-panel hidden";

    panel.innerHTML = `
        <div class="dashboard-header">
            <div>
                <h2>PA Payments</h2>
                <p>Update payment status for appointments assigned to you.</p>
            </div>

            <button id="refreshPaPaymentsButton" class="secondary-button" type="button">
                Refresh Payments
            </button>
        </div>

        <div id="paPaymentsMessage" class="form-result"></div>

        <div class="queue-filter-grid">
            <div>
                <label>Date</label>
                <input id="paPaymentsDate" type="date">
            </div>
        </div>

        <div id="paPaymentsList" class="compact-list scroll-list tall-scroll-list">
            <p class="muted-text">No payments loaded.</p>
        </div>
    `;

    paDashboard.appendChild(panel);

    const messageBox = document.getElementById("paPaymentsMessage");
    const refreshButton = document.getElementById("refreshPaPaymentsButton");
    const dateInput = document.getElementById("paPaymentsDate");
    const paymentsList = document.getElementById("paPaymentsList");

    function showMessage(message, type) {
        messageBox.textContent = message;
        messageBox.classList.remove("ok", "error", "pending");

        if (type) {
            messageBox.classList.add(type);
        }
    }

    function todayIsoDate() {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, "0");
        const day = String(now.getDate()).padStart(2, "0");

        return `${year}-${month}-${day}`;
    }

    function money(value) {
        const number = Number(value || 0);
        return `Rs. ${number.toLocaleString()}`;
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
            console.log("PA_PAYMENT_API_ERROR:", result);
            throw new Error(result.error || result.message || "Request failed.");
        }

        return result;
    }

    function switchToPaymentsTab() {
        paDashboard.querySelectorAll(".pa-module-tab").forEach((tab) => {
            tab.classList.remove("active");
        });

        paDashboard.querySelectorAll(".pa-module-panel").forEach((panelItem) => {
            panelItem.classList.add("hidden");
        });

        tabButton.classList.add("active");
        panel.classList.remove("hidden");

        loadPayments();
    }

    function hideIfOtherTabClicked(event) {
        const clickedTab = event.target.closest(".pa-module-tab");

        if (!clickedTab) {
            return;
        }

        if (clickedTab.getAttribute("data-pa-tab") !== "paPaymentsTab") {
            tabButton.classList.remove("active");
            panel.classList.add("hidden");
        }
    }

    async function loadPayments() {
        try {
            if (!dateInput.value) {
                dateInput.value = todayIsoDate();
            }

            showMessage("Loading payments...", "pending");

            const result = await apiRequest(`/api/pa/appointments?date=${dateInput.value}`);
            const appointments = result.data || [];

            renderPayments(appointments);

            showMessage(`${appointments.length} appointment(s) loaded.`, "ok");
        } catch (error) {
            showMessage(error.message, "error");
        }
    }

    function renderPayments(appointments) {
        if (!appointments.length) {
            paymentsList.innerHTML = `<p class="muted-text">No appointments found for this date.</p>`;
            return;
        }

        paymentsList.innerHTML = appointments.map((appointment) => {
            return `
                <div class="online-request-card" data-appointment-id="${appointment.appointment_id}">
                    <strong>${appointment.patient_name}</strong>
                    <span>CNIC: ${appointment.patient_cnic}</span>
                    <span>Time: ${formatDateTime(appointment.appointment_datetime)}</span>
                    <span>Doctor: ${appointment.doctor_name}</span>
                    <span>Hospital: ${appointment.hospital_name} - ${appointment.hospital_city || ""}</span>
                    <span>Current Fee: ${money(appointment.fee_charged)} (${appointment.fee_status})</span>
                    <span>Status: ${appointment.status}</span>

                    <div class="payment-form-grid">
                        <div>
                            <label>Fee</label>
                            <input type="number" class="pa-payment-fee" value="${appointment.fee_charged || 0}">
                        </div>

                        <div>
                            <label>Fee Status</label>
                            <select class="pa-payment-status">
                                <option value="pending" ${appointment.fee_status === "pending" ? "selected" : ""}>Pending</option>
                                <option value="paid" ${appointment.fee_status === "paid" ? "selected" : ""}>Paid</option>
                                <option value="waived" ${appointment.fee_status === "waived" ? "selected" : ""}>Waived</option>
                            </select>
                        </div>

                        <div>
                            <label>Method</label>
                            <select class="pa-payment-method">
                                <option value="">None</option>
                                <option value="cash">Cash</option>
                                <option value="card">Card</option>
                                <option value="bank_transfer">Bank Transfer</option>
                                <option value="online">Online</option>
                                <option value="other">Other</option>
                            </select>
                        </div>
                    </div>

                    <label>Payment Note</label>
                    <textarea class="pa-payment-note" placeholder="Payment note"></textarea>

                    <button type="button" data-action="update-payment">
                        Update Payment
                    </button>
                </div>
            `;
        }).join("");
    }

    async function updatePayment(card) {
        const appointmentId = card.getAttribute("data-appointment-id");

        const fee = card.querySelector(".pa-payment-fee").value;
        const status = card.querySelector(".pa-payment-status").value;
        const method = card.querySelector(".pa-payment-method").value;
        const note = card.querySelector(".pa-payment-note").value;

        try {
            showMessage("Updating payment...", "pending");

            const result = await apiRequest(`/api/appointments/${appointmentId}/payment`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    fee_charged: Number(fee || 0),
                    fee_status: status,
                    payment_method: method,
                    discount_amount: 0,
                    refund_amount: 0,
                    payment_note: note
                })
            });

            showMessage(result.message, "ok");

            await loadPayments();
        } catch (error) {
            showMessage(error.message, "error");
        }
    }

    function handleAction(event) {
        const button = event.target.closest("button[data-action]");

        if (!button) {
            return;
        }

        const card = event.target.closest(".online-request-card");

        if (!card) {
            return;
        }

        if (button.getAttribute("data-action") === "update-payment") {
            updatePayment(card);
        }
    }

    tabButton.addEventListener("click", switchToPaymentsTab);
    tabContainer.addEventListener("click", hideIfOtherTabClicked);
    refreshButton.addEventListener("click", loadPayments);
    dateInput.addEventListener("change", loadPayments);
    paymentsList.addEventListener("click", handleAction);
});