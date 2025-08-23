const footer = document.querySelector('.site-footer');
function checkScroll() {
  const scrollPosition = window.scrollY + window.innerHeight;
  const pageHeight = document.documentElement.scrollHeight;

  // Show footer if user scrolled within 100px of bottom
  if (scrollPosition >= pageHeight - 100) {
    footer.classList.add('visible');
    footer.classList.remove('hidden');
  } else {
    footer.classList.remove('visible');
    footer.classList.add('hidden');
  }
}

document.getElementById('connect-twitch-btn').addEventListener('click', () => {
  window.location.href = '/login';
})

function updateStats() {
  fetch('/stats.json')
    .then(res => res.json())
    .then(data => {
      if (data.userCount !== undefined) {
        document.getElementById('user-count').textContent = data.userCount;
      }
      if (data.commandsProcessed !== undefined) {
        document.getElementById('commands-processed').textContent = `Commands processed: ${data.commandsProcessed}`;
      }
      if (data.uptime !== undefined) {
        // Convert uptime seconds to human readable
        const hours = Math.floor(data.uptime / 3600);
        const minutes = Math.floor((data.uptime % 3600) / 60);
        const seconds = data.uptime % 60;
        document.getElementById('uptime').textContent = `Uptime: ${hours}h ${minutes}m ${seconds}s`;
      }
    })
    .catch(() => {});
}

document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener("click", function (e) {
    const target = document.querySelector(this.getAttribute("href"));
    if (target) {
      e.preventDefault();
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });
});

window.addEventListener('scroll', checkScroll);
window.addEventListener('load', checkScroll);
(() => {
  const slides = document.querySelector(".slides");
  const slideCount = slides.children.length;
  const prevBtn = document.querySelector(".carousel-nav.prev");
  const nextBtn = document.querySelector(".carousel-nav.next");
  let currentIndex = 0;

  function updateCarousel() {
    const slideWidth =
      slides.children[0].offsetWidth +
      parseInt(getComputedStyle(slides.children[0]).marginRight);
    slides.style.transform = `translateX(${-slideWidth * currentIndex}px)`;
  }

  prevBtn.addEventListener("click", () => {
    currentIndex = (currentIndex - 1 + slideCount) % slideCount;
    updateCarousel();
  });

  nextBtn.addEventListener("click", () => {
    currentIndex = (currentIndex + 1) % slideCount;
    updateCarousel();
  });

  
  setInterval(() => {
    currentIndex = (currentIndex + 1) % slideCount;
    updateCarousel();
  }, 6000);

  
  window.addEventListener("load", updateCarousel);
  window.addEventListener("resize", updateCarousel);
  window.addEventListener('DOMContentLoaded', updateStats);
})();