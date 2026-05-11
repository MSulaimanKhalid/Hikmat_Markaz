document.addEventListener("DOMContentLoaded", () => {
    function normalizeCnic(value) {
        return String(value || "").replace(/\D/g, "").slice(0, 13);
    }

    function normalizePhone(value) {
        return String(value || "").replace(/\D/g, "").slice(0, 11);
    }

    function attachCnicRules() {
        const inputs = Array.from(document.querySelectorAll("input"));

        inputs.forEach((input) => {
            const id = (input.id || "").toLowerCase();
            const name = (input.name || "").toLowerCase();
            const placeholder = (input.placeholder || "").toLowerCase();

            const looksLikeCnic =
                id.includes("cnic") ||
                name.includes("cnic") ||
                placeholder.includes("cnic");

            if (!looksLikeCnic) {
                return;
            }

            input.maxLength = 13;
            input.inputMode = "numeric";

            input.addEventListener("input", () => {
                input.value = normalizeCnic(input.value);
            });

            input.addEventListener("blur", () => {
                if (input.value && !/^[0-9]{13}$/.test(input.value)) {
                    input.setCustomValidity("CNIC must be exactly 13 digits.");
                    input.reportValidity();
                } else {
                    input.setCustomValidity("");
                }
            });
        });
    }

    function attachPhoneRules() {
        const inputs = Array.from(document.querySelectorAll("input"));

        inputs.forEach((input) => {
            const id = (input.id || "").toLowerCase();
            const name = (input.name || "").toLowerCase();
            const placeholder = (input.placeholder || "").toLowerCase();

            const looksLikePhone =
                id.includes("phone") ||
                name.includes("phone") ||
                placeholder.includes("phone");

            if (!looksLikePhone) {
                return;
            }

            input.maxLength = 11;
            input.inputMode = "numeric";

            input.addEventListener("input", () => {
                input.value = normalizePhone(input.value);
            });

            input.addEventListener("blur", () => {
                if (input.value && !/^03[0-9]{9}$/.test(input.value)) {
                    input.setCustomValidity("Phone must be in format 03XXXXXXXXX.");
                    input.reportValidity();
                } else {
                    input.setCustomValidity("");
                }
            });
        });
    }

    attachCnicRules();
    attachPhoneRules();

    const observer = new MutationObserver(() => {
        attachCnicRules();
        attachPhoneRules();
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
});