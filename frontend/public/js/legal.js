document.addEventListener('DOMContentLoaded', () => {
    const contentContainer = document.getElementById('legal-content');
    const tabs = document.querySelectorAll('.tab-btn');

    // Function to load markdown content
    async function loadContent(type) {
        // Update active tab
        tabs.forEach(tab => {
            if (tab.dataset.target === type) {
                tab.classList.add('active');
            } else {
                tab.classList.remove('active');
            }
        });

        // Show loading state
        contentContainer.innerHTML = '<div class="loading-spinner">Loading...</div>';
        contentContainer.style.opacity = '0.5';

        try {
            const fileName = type === 'privacy' ? 'privacy.md' : 'terms.md';
            const response = await fetch(fileName);

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const text = await response.text();

            // Parse markdown using marked.js
            contentContainer.innerHTML = marked.parse(text);
            contentContainer.style.opacity = '1';

            // Update URL hash without scrolling
            history.replaceState(null, null, `#${type}`);

        } catch (error) {
            console.error('Error loading content:', error);
            contentContainer.innerHTML = `
                <div class="error-message">
                    <h3>Error Loading Content</h3>
                    <p>Could not load the requested document. Please try again later.</p>
                    <p class="small">Note: If you are opening this file locally without a server, browser security policies may block reading the .md files.</p>
                </div>
            `;
            contentContainer.style.opacity = '1';
        }
    }

    // Handle tab clicks
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const target = tab.dataset.target;
            loadContent(target);
        });
    });

    // Handle initial load based on hash
    function handleInitialLoad() {
        const hash = window.location.hash.replace('#', '');
        if (hash === 'terms') {
            loadContent('terms');
        } else {
            loadContent('privacy');
        }
    }

    handleInitialLoad();
});
