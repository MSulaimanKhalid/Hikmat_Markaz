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
    tabButton.setAttribute("data-pa-tab", "paOnlineRequestsTab");
    tabButton.textContent = "Online Requests";

    tabContainer.appendChild(tabButton);

    const panel = document.createElement("section");
    panel.id = "paOnlineRequestsTab";
    panel.className = "pa-module-panel hidden";

    panel.innerHTML = `
        <div class="dashboard-header">
            <div>
                <h2>Online Appointment Requests</h2>
                <p>Confirm or reject appointment requests submitted by patients.</p>
            </div>

            <button id="refreshOnlineRequestsButton" class="secondary-button" type="button">
                Refresh
            </button>
        </div>

        <div id="onlineRequestsMessage" class="form-result"></div>

        <div class="queue-filter-grid">
            <div>
                <label>Status</label>
                <select id="onlineRequestStatus">
                    <option value="pending">Pending</option>
                    <option value="confirmed">Confirmed</option>
                    <option value="rejected">Rejected</option>
                    <option value="all">All</option>
                </select>
            </div>
        </div>

        <div id="onlineRequestsList" class="compact-list scroll-list tall-scroll-list">
            <p class="muted-text">No online requests loaded.</p>
        </div>
    `;

    paDashboard.appendChild(panel);

    const messageBox = document.getElementById("onlineRequestsMessage");
    const refreshButton = document.getElementById("refreshOnlineRequestsButton");
    const statusSelect = document.getElementById("onlineRequestStatus");
    const requestsList = document.getElementById("onlineRequestsList");

    function showMessage(message, type) {
        messageBox.textContent = message;
        messageBox.classList.remove("ok", "error", "pending");

        if (type) {
            messageBox.classList.add(type);
        }
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
            console.log("PA_ONLINE_REQUEST_API_ERROR:", result);
            throw new Error(result.error || result.message || "Request failed.");
        }

        return result;
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

    function switchToOnlineRequestsTab() {
        paDashboard.querySelectorAll(".pa-module-tab").forEach((tab) => {
            tab.classList.remove("active");
        });

        paDashboard.querySelectorAll(".pa-module-panel").forEach((panelItem) => {
            panelItem.classList.add("hidden");
        });

        tabButton.classList.add("active");
        panel.classList.remove("hidden");

        loadOnlineRequests();
    }

    function hideIfOtherTabClicked(event) {
        const clickedTab = event.target.closest(".pa-module-tab");

        if (!clickedTab) {
            return;
        }

        if (clickedTab.getAttribute("data-pa-tab") !== "paOnlineRequestsTab") {
            panel.classList.add("hidden");
            tabButton.classList.remove("active");
        }
    }

    async function loadOnlineRequests() {
        try {
            showMessage("Loading online requests...", "pending");

            const result = await apiRequest(`/api/pa/appointment-requests?status=${statusSelect.value}`);

            renderRequests(result.data || []);

            showMessage(`${(result.data || []).length} request(s) loaded.`, "ok");
        } catch (error) {
            showMessage(error.message, "error");
        }
    }

    function renderRequests(requests) {
        if (!requests.length) {
            requestsList.innerHTML = `<p class="muted-text">No online requests found.</p>`;
            return;
        }

        requestsList.innerHTML = requests.map((request) => {
            const canAct = request.status === "pending";

            return `
                <div class="online-request-card" data-request-id="${request.request_id}">
                    <strong>${request.patient_name}</strong>
                    <span>CNIC: ${request.patient_cnic}</span>
                    <span>Phone: ${request.patient_phone || "N/A"}</span>
                    <span>Doctor: ${request.doctor_name} (${request.specialization || "Doctor"})</span>
                    <span>Hospital: ${request.hospital_name} - ${request.hospital_city || ""}</span>
                    <span>Requested Time: ${formatDateTime(request.requested_datetime)}</span>
                    <span>Expected Fee: ${request.expected_fee}</span>
                    <span>Status: ${request.status}</span>
                    ${request.patient_notes ? `<span>Patient Notes: ${request.patient_notes}</span>` : ""}
                    ${request.rejection_reason ? `<span>Rejection Reason: ${request.rejection_reason}</span>` : ""}

                    ${
                        canAct
                            ? `
                                <div class="queue-card-actions">
                                    <button type="button" data-action="confirm">
                                        Confirm
                                    </button>

                                    <button type="button" class="danger-button" data-action="reject">
                                        Reject
                                    </button>
                                </div>
                            `
                            : ""
                    }
                </div>
            `;
        }).join("");
    }

    async function confirmRequest(requestId) {
        const feeStatus = window.prompt("Fee status? Type pending, paid, or waived", "pending");

        if (feeStatus === null) {
            return;
        }

        const paNotes = window.prompt("PA notes optional", "") || "";

        try {
            showMessage("Confirming request...", "pending");

            const result = await apiRequest(`/api/pa/appointment-requests/${requestId}/confirm`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    fee_status: feeStatus,
                    pa_notes: paNotes
                })
            });

            showMessage(result.message, "ok");
            await loadOnlineRequests();
        } catch (error) {
            showMessage(error.message, "error");
        }
    }

    async function rejectRequest(requestId) {
        const reason = window.prompt("Reason for rejection");

        if (!reason) {
            showMessage("Rejection reason is required.", "error");
            return;
        }

        try {
            showMessage("Rejecting request...", "pending");

            const result = await apiRequest(`/api/pa/appointment-requests/${requestId}/reject`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    rejection_reason: reason
                })
            });

            showMessage(result.message, "ok");
            await loadOnlineRequests();
        } catch (error) {
            showMessage(error.message, "error");
        }
    }

    function handleRequestAction(event) {
        const button = event.target.closest("button[data-action]");

        if (!button) {
            return;
        }

        const card = event.target.closest(".online-request-card");

        if (!card) {
            return;
        }

        const requestId = card.getAttribute("data-request-id");
        const action = button.getAttribute("data-action");

        if (action === "confirm") {
            confirmRequest(requestId);
        }

        if (action === "reject") {
            rejectRequest(requestId);
        }
    }

    tabButton.addEventListener("click", switchToOnlineRequestsTab);
    tabContainer.addEventListener("click", hideIfOtherTabClicked);
    refreshButton.addEventListener("click", loadOnlineRequests);
    statusSelect.addEventListener("change", loadOnlineRequests);
    requestsList.addEventListener("click", handleRequestAction);
});