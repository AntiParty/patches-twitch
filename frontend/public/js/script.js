// Scroll reveal
const revealObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("visible");
        revealObserver.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.08, rootMargin: "0px 0px -40px 0px" }
);

document.querySelectorAll(".reveal").forEach((el) => revealObserver.observe(el));

// Mobile menu toggle
const menuBtn = document.querySelector(".mobile-menu-btn");
const navLinks = document.querySelector(".nav-links");

if (menuBtn && navLinks) {
  menuBtn.addEventListener("click", () => {
    const isOpen = navLinks.classList.toggle("is-open");
    menuBtn.setAttribute("aria-expanded", String(isOpen));
  });
}

async function checkLoginStatus() {
  try {
    const response = await fetch("/api/auth/status");
    if (!response.ok) return;

    const data = await response.json();
    if (data.isAuthenticated) {
      updateAuthUI();
    }
  } catch (err) {
    // Anonymous visitors are expected on the landing page.
  }
}

function updateAuthUI() {
  document.querySelectorAll(".btn-login").forEach((btn) => {
    btn.textContent = "Dashboard";
    btn.href = "/dashboard";
  });

  const heroBtn = document.querySelector(".landing-hero .btn-primary");
  if (heroBtn) {
    heroBtn.textContent = "Go to Dashboard";
    heroBtn.href = "/dashboard";
  }
}

checkLoginStatus();
