import { initGravity } from "./gravity.js";
import { initContactForm } from "./contact.js";

const motionButton = document.querySelector("#motion-toggle");
const motionLabel = motionButton.querySelector(".motion-label");
const motionIcon = motionButton.querySelector(".pause-icon");
const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
let manuallyPaused = false;
const gravity = initGravity(document.querySelector("#gravity"));
const orbit = document.querySelector(".orbit-art");

function syncMotion() {
  const paused = manuallyPaused || motionPreference.matches;
  gravity.setPaused(paused);
  if (paused || document.hidden) orbit.pauseAnimations();
  else orbit.unpauseAnimations();
  motionButton.setAttribute("aria-pressed", String(paused));
  motionButton.disabled = motionPreference.matches;
  motionLabel.textContent = motionPreference.matches
    ? "Reduced motion"
    : paused
      ? "Resume motion"
      : "Pause motion";
  motionIcon.textContent = paused ? "▷" : "Ⅱ";
}
motionButton.addEventListener("click", () => {
  manuallyPaused = !manuallyPaused;
  syncMotion();
});
motionPreference.addEventListener("change", syncMotion);
document.addEventListener("visibilitychange", syncMotion);
syncMotion();
const contactForm = document.querySelector("#contact-form");
// GitHub Pages serves static files and cannot run the Node SMTP endpoint.
if (location.hostname.endsWith(".github.io")) contactForm.hidden = true;
else initContactForm(contactForm);

const menuButton = document.querySelector(".menu-toggle");
const mobileNav = document.querySelector("#mobile-nav");
function closeMenu() {
  menuButton.setAttribute("aria-expanded", "false");
  menuButton.setAttribute("aria-label", "Open navigation");
  mobileNav.hidden = true;
}
menuButton.addEventListener("click", () => {
  const open = menuButton.getAttribute("aria-expanded") !== "true";
  menuButton.setAttribute("aria-expanded", String(open));
  menuButton.setAttribute(
    "aria-label",
    open ? "Close navigation" : "Open navigation",
  );
  mobileNav.hidden = !open;
});
mobileNav.addEventListener("click", (event) => {
  if (event.target.closest("a")) closeMenu();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !mobileNav.hidden) {
    closeMenu();
    menuButton.focus();
  }
});
window.matchMedia("(min-width: 601px)").addEventListener("change", closeMenu);

const sections = document.querySelectorAll("main section[id]");
const navLinks = document.querySelectorAll(".desktop-nav a");
const observer = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      for (const link of navLinks) {
        if (link.hash === `#${entry.target.id}`)
          link.setAttribute("aria-current", "location");
        else link.removeAttribute("aria-current");
      }
    }
  },
  { rootMargin: "-15% 0px -60% 0px" },
);
sections.forEach((section) => observer.observe(section));

const copyButton = document.querySelector("#copy-email");
const copyStatus = document.querySelector("#copy-status");
let copyStatusTimeout;
copyButton.addEventListener("click", async () => {
  clearTimeout(copyStatusTimeout);
  try {
    await navigator.clipboard.writeText("devanshadhinilinkedin@gmail.com");
    copyStatus.textContent = "Email copied. Say hello whenever you’re ready.";
    copyStatusTimeout = setTimeout(() => {
      copyStatus.textContent = "";
    }, 5000);
  } catch {
    copyStatus.textContent = "devanshadhinilinkedin@gmail.com";
  }
});
document.querySelector("#year").textContent = new Date().getFullYear();
