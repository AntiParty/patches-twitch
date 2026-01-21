(function() {
    if (window.feedbackSystemInitialized) return;
    window.feedbackSystemInitialized = true;

    // Inject CSS
    if (!document.querySelector('link[href*="feedback.css"]')) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = '/css/feedback.css';
        document.head.appendChild(link);
    }

    // Create Button
    const button = document.createElement('button');
    button.className = 'feedback-btn';
    button.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
        <span>Feedback</span>
    `;
    document.body.appendChild(button);

    // Create Modal
    const modalOverlay = document.createElement('div');
    modalOverlay.className = 'feedback-modal-overlay';
    modalOverlay.innerHTML = `
        <div class="feedback-modal">
            <button class="feedback-close">&times;</button>
            <h2>Send Feedback</h2>
            <span class="feedback-subtitle">Tell us what's on your mind.</span>
            
            <form id="feedback-form">
                <div class="feedback-form-group">
                    <label for="feedback-type">Type</label>
                    <select id="feedback-type" class="feedback-select" required>
                        <option value="general">General</option>
                        <option value="bug">Bug Report</option>
                        <option value="feature">Feature Request</option>
                    </select>
                </div>
                <div class="feedback-form-group">
                    <label for="feedback-message">Details</label>
                    <textarea id="feedback-message" class="feedback-textarea" placeholder="Describe it here..." minlength="5" maxlength="1000" required></textarea>
                </div>
                <button type="submit" class="feedback-submit-btn">Submit</button>
                <div class="feedback-status"></div>
            </form>
        </div>
    `;
    document.body.appendChild(modalOverlay);

    const form = modalOverlay.querySelector('#feedback-form');
    const closeBtn = modalOverlay.querySelector('.feedback-close');
    const statusDiv = modalOverlay.querySelector('.feedback-status');
    const submitBtn = modalOverlay.querySelector('.feedback-submit-btn');
    const messageInput = modalOverlay.querySelector('#feedback-message');

    function openModal() {
        modalOverlay.classList.add('open');
        messageInput.focus();
    }

    function closeModal() {
        modalOverlay.classList.remove('open');
        setTimeout(() => {
            if (!modalOverlay.classList.contains('open')) {
                statusDiv.textContent = '';
                statusDiv.className = 'feedback-status';
                form.reset();
            }
        }, 200);
    }

    button.addEventListener('click', openModal);
    closeBtn.addEventListener('click', closeModal);
    modalOverlay.addEventListener('click', (e) => {
        if (e.target === modalOverlay) closeModal();
    });

    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modalOverlay.classList.contains('open')) {
            closeModal();
        }
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const type = document.getElementById('feedback-type').value;
        const message = messageInput.value.trim();

        submitBtn.disabled = true;
        const originalText = submitBtn.textContent;
        submitBtn.textContent = 'Sending...';

        try {
            const csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content');
            const headers = { 'Content-Type': 'application/json' };
            if (csrfToken) headers['CSRF-Token'] = csrfToken;

            const response = await fetch('/api/feedback', {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({ type, message })
            });

            const data = await response.json();

            if (response.ok) {
                statusDiv.className = 'feedback-status success';
                statusDiv.textContent = 'Feedback sent! Thank you.';
                setTimeout(closeModal, 1500);
            } else {
                throw new Error(data.error || 'Failed to submit');
            }
        } catch (err) {
            statusDiv.textContent = err.message;
            statusDiv.className = 'feedback-status error';
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = originalText;
        }
    });
})();
