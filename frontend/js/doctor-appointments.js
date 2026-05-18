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

    let selectedAppointmentId = null;

    let tabButton = document.querySelector('[data-doctor-tab="doctorAppointmentsTab"]');

    if (!tabButton) {
        tabButton = document.createElement("button");
        tabButton.className = "doctor-module-tab";
        tabButton.type = "button";
        tabButton.setAttribute("data-doctor-tab", "doctorAppointmentsTab");
        tabButton.textContent = "Appointments";
        tabContainer.appendChild(tabButton);
    }

    let panel = document.getElementById("doctorAppointmentsTab");

    if (!panel) {
        panel = document.createElement("section");
        panel.id = "doctorAppointmentsTab";
        panel.className = "doctor-module-panel hidden";
        doctorDashboard.appendChild(panel);
    }

    panel.innerHTML = `
        <div class="dashboard-header">
            <div>
                <h2>Doctor Appointments</h2>
                <p>View appointment history, upcoming appointments, payment status, and patient details.</p>
            </div>

            <button id="refreshDoctorAppointmentsButton" class="secondary-button" type="button">
                Refresh
            </button>
        </div>

        <div id="doctorAppointmentsMessage" class="form-result"></div>

        <div class="appointment-filter-grid">
            <div>
                <label>Date From</label>
                <input id="doctorAppointmentsDateFrom" type="date">
            </div>

            <div>
                <label>Date To</label>
                <input id="doctorAppointmentsDateTo" type="date">
            </div>

            <div>
                <label>Hospital</label>
                <select id="doctorAppointmentsHospital">
                    <option value="">All hospitals</option>
                </select>
            </div>

            <div>
                <label>PA</label>
                <select id="doctorAppointmentsPa">
                    <option value="">All PAs</option>
                </select>
            </div>

            <div>
                <label>Status</label>
                <select id="doctorAppointmentsStatus">
                    <option value="all">All</option>
                    <option value="pending_fee">Pending Fee</option>
                    <option value="waiting">Waiting</option>
                    <option value="in_consultation">In Consultation</option>
                    <option value="completed">Completed</option>
                    <option value="cancelled">Cancelled</option>
                    <option value="no_show">No Show</option>
                </select>
            </div>

            <div>
                <label>Fee Status</label>
                <select id="doctorAppointmentsFeeStatus">
                    <option value="all">All</option>
                    <option value="pending">Pending</option>
                    <option value="paid">Paid</option>
                    <option value="waived">Waived</option>
                </select>
            </div>

            <div>
                <label>Source</label>
                <select id="doctorAppointmentsSource">
                    <option value="all">All</option>
                    <option value="walk_in">Walk-in</option>
                    <option value="online_request">Online Request</option>
                    <option value="phone_call">Phone Call</option>
                </select>
            </div>

            <div>
                <label>Search Patient</label>
                <input id="doctorAppointmentsSearch" type="text" placeholder="Name, CNIC, phone">
            </div>
        </div>

        <div class="doctor-appointments-layout">
            <div class="settings-list-card">
                <h3>Appointments</h3>
                <div id="doctorAppointmentsList" class="compact-list scroll-list tall-scroll-list">
                    <p class="muted-text">No appointments loaded.</p>
                </div>
            </div>

            <div class="settings-list-card appointment-detail-card">
                <h3>Appointment Details</h3>
                <div id="doctorAppointmentDetailBox">
                    <p class="muted-text">Select an appointment to view details.</p>
                </div>
            </div>
        </div>
    `;

    const messageBox = document.getElementById("doctorAppointmentsMessage");
    const refreshButton = document.getElementById("refreshDoctorAppointmentsButton");
    const dateFromInput = document.getElementById("doctorAppointmentsDateFrom");
    const dateToInput = document.getElementById("doctorAppointmentsDateTo");
    const hospitalSelect = document.getElementById("doctorAppointmentsHospital");
    const paSelect = document.getElementById("doctorAppointmentsPa");
    const statusSelect = document.getElementById("doctorAppointmentsStatus");
    const feeStatusSelect = document.getElementById("doctorAppointmentsFeeStatus");
    const sourceSelect = document.getElementById("doctorAppointmentsSource");
    const searchInput = document.getElementById("doctorAppointmentsSearch");
    const appointmentsList = document.getElementById("doctorAppointmentsList");
    const detailBox = document.getElementById("doctorAppointmentDetailBox");

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
        to.setDate(now.getDate() + 14);

        dateFromInput.value = localDateString(from);
        dateToInput.value = localDateString(to);
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

    function money(value) {
        const number = Number(value || 0);
        return `Rs. ${number.toLocaleString()}`;
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
            console.log("DOCTOR_APPOINTMENTS_API_ERROR:", result);
            throw new Error(result.error || result.message || "Request failed.");
        }

        return result;
    }

    function switchToAppointmentsTab() {
        doctorDashboard.querySelectorAll(".doctor-module-tab").forEach((tab) => {
            tab.classList.remove("active");
        });

        doctorDashboard.querySelectorAll(".doctor-module-panel").forEach((panelItem) => {
            panelItem.classList.add("hidden");
        });

        tabButton.classList.add("active");
        panel.classList.remove("hidden");

        initializeAppointments();
    }

    function hideIfOtherTabClicked(event) {
        const clickedTab = event.target.closest(".doctor-module-tab");

        if (!clickedTab) {
            return;
        }

        if (clickedTab.getAttribute("data-doctor-tab") !== "doctorAppointmentsTab") {
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

        if (statusSelect.value && statusSelect.value !== "all") {
            params.set("status", statusSelect.value);
        }

        if (feeStatusSelect.value && feeStatusSelect.value !== "all") {
            params.set("fee_status", feeStatusSelect.value);
        }

        if (sourceSelect.value && sourceSelect.value !== "all") {
            params.set("source", sourceSelect.value);
        }

        if (searchInput.value.trim()) {
            params.set("search", searchInput.value.trim());
        }

        return params.toString();
    }

    async function loadAppointments() {
        try {
            showMessage("Loading appointments...", "pending");

            const result = await apiRequest(`/api/doctor/appointments?${buildQuery()}`);

            renderAppointments(result.data.appointments || []);

            showMessage(`${(result.data.appointments || []).length} appointment(s) loaded.`, "ok");
        } catch (error) {
            showMessage(error.message, "error");
        }
    }

    function renderAppointments(appointments) {
        if (!appointments.length) {
            appointmentsList.innerHTML = `<p class="muted-text">No appointments found.</p>`;
            return;
        }

        appointmentsList.innerHTML = appointments.map((appointment) => {
            return `
                <div class="doctor-appointment-card" data-appointment-id="${appointment.appointment_id}">
                    <div class="queue-card-top">
                        <div>
                            <strong>${appointment.patient_name}</strong>
                            <span>${formatDateTime(appointment.appointment_datetime)}</span>
                        </div>

                        <span class="queue-status-pill ${appointment.status}">
                            ${appointment.status}
                        </span>
                    </div>

                    <div class="queue-card-meta">
                        <span>CNIC: ${appointment.patient_cnic}</span>
                        <span>Phone: ${appointment.patient_phone || "N/A"}</span>
                        <span>Hospital: ${appointment.hospital_name} - ${appointment.hospital_city || ""}</span>
                        <span>PA: ${appointment.pa_name || appointment.pa_email || "N/A"}</span>
                        <span>Fee: ${money(appointment.fee_charged)} (${appointment.fee_status})</span>
                        <span>Source: ${appointment.source}</span>
                        ${appointment.diagnosis_text ? `<span>Diagnosis: ${appointment.diagnosis_text}</span>` : ""}
                    </div>

                    <div class="queue-card-actions">
                        <button type="button" data-action="open">
                            Open Details
                        </button>

                        <button type="button" class="secondary-button" data-action="payment">
                            Update Payment
                        </button>

                        ${
                            !["completed", "in_consultation", "cancelled", "no_show"].includes(appointment.status)
                                ? `
                                    <button type="button" class="secondary-button" data-action="no-show">
                                        No Show
                                    </button>

                                    <button type="button" class="danger-button" data-action="cancel">
                                        Cancel
                                    </button>
                                `
                                : ""
                        }
                    </div>
                </div>
            `;
        }).join("");
    }

    async function openAppointmentDetail(appointmentId) {
        try {
            selectedAppointmentId = appointmentId;

            showMessage("Loading appointment detail...", "pending");

            const result = await apiRequest(`/api/doctor/appointments/${appointmentId}`);

            renderAppointmentDetail(result.data);

            showMessage("Appointment detail loaded.", "ok");
        } catch (error) {
            showMessage(error.message, "error");
        }
    }

    function renderAppointmentDetail(data) {
        const appointment = data.appointment;
        const visit = data.visit;
        const diagnosis = data.diagnosis;
        const dynamicValues = data.dynamic_values || [];
        const paymentLogs = data.payment_logs || [];

        detailBox.innerHTML = `
            <div class="appointment-detail-section">
                <h4>Patient</h4>
                <p><strong>Name:</strong> ${appointment.patient_name}</p>
                <p><strong>CNIC:</strong> ${appointment.patient_cnic}</p>
                <p><strong>Gender:</strong> ${appointment.patient_gender || "N/A"}</p>
                <p><strong>Phone:</strong> ${appointment.patient_phone || "N/A"}</p>
                <p><strong>Email:</strong> ${appointment.patient_email || "N/A"}</p>
            </div>

            <div class="appointment-detail-section">
                <h4>Appointment</h4>
                <p><strong>Time:</strong> ${formatDateTime(appointment.appointment_datetime)}</p>
                <p><strong>Hospital:</strong> ${appointment.hospital_name} - ${appointment.hospital_city || ""}</p>
                <p><strong>PA:</strong> ${appointment.pa_name || appointment.pa_email || "N/A"}</p>
                <p><strong>Status:</strong> ${appointment.status}</p>
                <p><strong>Source:</strong> ${appointment.source}</p>
                <p><strong>Actual Start:</strong> ${formatDateTime(appointment.actual_start)}</p>
                <p><strong>Actual End:</strong> ${formatDateTime(appointment.actual_end)}</p>
            </div>

            <div class="appointment-detail-section">
                <h4>Payment</h4>

                <div class="payment-form-grid">
                    <div>
                        <label>Fee Charged</label>
                        <input id="detailFeeCharged" type="number" value="${appointment.fee_charged || 0}">
                    </div>

                    <div>
                        <label>Fee Status</label>
                        <select id="detailFeeStatus">
                            <option value="pending" ${appointment.fee_status === "pending" ? "selected" : ""}>Pending</option>
                            <option value="paid" ${appointment.fee_status === "paid" ? "selected" : ""}>Paid</option>
                            <option value="waived" ${appointment.fee_status === "waived" ? "selected" : ""}>Waived</option>
                        </select>
                    </div>

                    <div>
                        <label>Payment Method</label>
                        <select id="detailPaymentMethod">
                            <option value="">None</option>
                            <option value="cash" ${appointment.payment_method === "cash" ? "selected" : ""}>Cash</option>
                            <option value="card" ${appointment.payment_method === "card" ? "selected" : ""}>Card</option>
                            <option value="bank_transfer" ${appointment.payment_method === "bank_transfer" ? "selected" : ""}>Bank Transfer</option>
                            <option value="online" ${appointment.payment_method === "online" ? "selected" : ""}>Online</option>
                            <option value="other" ${appointment.payment_method === "other" ? "selected" : ""}>Other</option>
                        </select>
                    </div>

                    <div>
                        <label>Discount</label>
                        <input id="detailDiscountAmount" type="number" value="${appointment.discount_amount || 0}">
                    </div>

                    <div>
                        <label>Refund</label>
                        <input id="detailRefundAmount" type="number" value="${appointment.refund_amount || 0}">
                    </div>
                </div>

                <label>Payment Note</label>
                <textarea id="detailPaymentNote" placeholder="Payment note">${appointment.payment_note || ""}</textarea>

                <button id="updateDetailPaymentButton" type="button">
                    Update Payment
                </button>
            </div>

            ${
                diagnosis
                    ? `
                        <div class="appointment-detail-section">
                            <h4>Clinical Summary</h4>
                            <p><strong>Diagnosis:</strong> ${diagnosis.diagnosis_text || "N/A"}</p>
                            <p><strong>Treatment:</strong> ${diagnosis.treatment_plan || "N/A"}</p>
                            <p><strong>Follow-up:</strong> ${diagnosis.follow_up_notes || "N/A"}</p>
                        </div>
                    `
                    : `
                        <div class="appointment-detail-section">
                            <h4>Clinical Summary</h4>
                            <p class="muted-text">No completed diagnosis found.</p>
                        </div>
                    `
            }

            ${
                visit
                    ? `
                        <div class="appointment-detail-section">
                            <h4>Vitals</h4>
                            <p><strong>BP:</strong> ${visit.bp || "N/A"}</p>
                            <p><strong>Pulse:</strong> ${visit.pulse || "N/A"}</p>
                            <p><strong>Temperature:</strong> ${visit.temperature || "N/A"}</p>
                            <p><strong>Weight:</strong> ${visit.weight || "N/A"}</p>
                        </div>
                    `
                    : ""
            }

            ${
                dynamicValues.length
                    ? `
                        <div class="appointment-detail-section">
                            <h4>Dynamic Fields</h4>
                            ${dynamicValues.map((item) => {
                                return `<p><strong>${item.field_label || "Field"}:</strong> ${item.value_text}</p>`;
                            }).join("")}
                        </div>
                    `
                    : ""
            }

            <div class="appointment-detail-section">
                <h4>Payment Logs</h4>
                ${
                    paymentLogs.length
                        ? paymentLogs.map((log) => {
                            return `
                                <div class="mini-log-item">
                                    <strong>${formatDateTime(log.created_at)}</strong>
                                    <span>${log.old_fee_status || "N/A"} → ${log.new_fee_status}</span>
                                    <span>Fee: ${money(log.old_fee_charged)} → ${money(log.new_fee_charged)}</span>
                                    <span>Method: ${log.payment_method || "N/A"}</span>
                                    <span>Note: ${log.payment_note || "N/A"}</span>
                                </div>
                            `;
                        }).join("")
                        : `<p class="muted-text">No payment logs yet.</p>`
                }
            </div>
        `;

        const updateButton = document.getElementById("updateDetailPaymentButton");

        if (updateButton) {
            updateButton.addEventListener("click", () => {
                updatePayment(appointment.appointment_id);
            });
        }
    }

    async function updatePayment(appointmentId) {
        const feeCharged = document.getElementById("detailFeeCharged");
        const feeStatus = document.getElementById("detailFeeStatus");
        const paymentMethod = document.getElementById("detailPaymentMethod");
        const discountAmount = document.getElementById("detailDiscountAmount");
        const refundAmount = document.getElementById("detailRefundAmount");
        const paymentNote = document.getElementById("detailPaymentNote");

        const payload = {
            fee_charged: Number(feeCharged.value || 0),
            fee_status: feeStatus.value,
            payment_method: paymentMethod.value,
            discount_amount: Number(discountAmount.value || 0),
            refund_amount: Number(refundAmount.value || 0),
            payment_note: paymentNote.value.trim()
        };

        try {
            showMessage("Updating payment...", "pending");

                const result = await apiRequest(`/api/appointments/${appointmentId}/payment`, {                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(payload)
            });

            showMessage(result.message, "ok");

            await loadAppointments();
            await openAppointmentDetail(appointmentId);
        } catch (error) {
            showMessage(error.message, "error");
        }
    }

    async function cancelAppointment(appointmentId) {
        const reason = window.prompt("Reason for cancellation", "Cancelled by doctor");

        if (reason === null) {
            return;
        }

        try {
            showMessage("Cancelling appointment...", "pending");

            const result = await apiRequest(`/api/doctor/appointments/${appointmentId}/cancel`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    reason
                })
            });

            showMessage(result.message, "ok");
            await loadAppointments();
        } catch (error) {
            showMessage(error.message, "error");
        }
    }

    async function markNoShow(appointmentId) {
        const confirmed = window.confirm("Mark this appointment as no-show?");

        if (!confirmed) {
            return;
        }

        try {
            showMessage("Marking no-show...", "pending");

            const result = await apiRequest(`/api/doctor/appointments/${appointmentId}/no-show`, {
                method: "POST"
            });

            showMessage(result.message, "ok");
            await loadAppointments();
        } catch (error) {
            showMessage(error.message, "error");
        }
    }

    function handleAppointmentAction(event) {
        const button = event.target.closest("button[data-action]");

        if (!button) {
            return;
        }

        const card = event.target.closest(".doctor-appointment-card");

        if (!card) {
            return;
        }

        const appointmentId = card.getAttribute("data-appointment-id");
        const action = button.getAttribute("data-action");

        if (action === "open") {
            openAppointmentDetail(appointmentId);
        }

        if (action === "payment") {
            openAppointmentDetail(appointmentId);
        }

        if (action === "cancel") {
            cancelAppointment(appointmentId);
        }

        if (action === "no-show") {
            markNoShow(appointmentId);
        }
    }

    let initialized = false;

    async function initializeAppointments() {
        try {
            if (!initialized) {
                setDefaultDates();
                await loadFilters();
                initialized = true;
            }

            await loadAppointments();
        } catch (error) {
            showMessage(error.message, "error");
        }
    }

    tabButton.addEventListener("click", switchToAppointmentsTab);
    tabContainer.addEventListener("click", hideIfOtherTabClicked);
    refreshButton.addEventListener("click", loadAppointments);
    appointmentsList.addEventListener("click", handleAppointmentAction);

    [
        dateFromInput,
        dateToInput,
        hospitalSelect,
        paSelect,
        statusSelect,
        feeStatusSelect,
        sourceSelect
    ].forEach((element) => {
        element.addEventListener("change", loadAppointments);
    });

    searchInput.addEventListener("keyup", (event) => {
        if (event.key === "Enter") {
            loadAppointments();
        }
    });
});