// /js/loadFooter.js
const footerHTML = `
<footer class="hf" id="page-footer">
  <div class="hf-inner">
    <div class="hf-top">
      <div class="hf-brand">
        <div class="hf-logo">⚕</div>
        <div>
          <div class="hf-name">Clinical Simulation</div>
          <div class="hf-tagline">MBBS Clinical Training Platform</div>
        </div>
        
      <div class="hf-msg-note" id="hf-msg-note"></div>
      </div>
      
      <div class="hf-links">
        <div class="hf-col">
          <div class="hf-col-title">Navigate</div>
          <a href="/index.html" class="hf-link">Home</a>
          <a href="/cases.html" class="hf-link">All Cases</a>
          <a href="/profile.html" class="hf-link">Profile</a>
          <a href="/help.html" class="hf-link">Help</a>
        </div>
        <div class="hf-col">
          <div class="hf-col-title">About</div>
          <a href="/about.html" class="hf-link">About Us</a>
          <a href="/tos.html" class="hf-link">ToS</a>
          <a href="mailto:mail@rajatcj.com" class="hf-link">Contact</a>
          <a href="mailto:mail@rajatcj.com" class="hf-link">Submit a Case</a>
        </div>
      </div>
    </div>

    <div class="hf-msg-section">
      <div class="hf-msg-title">Send a Message</div>
      <div class="hf-msg-form">
        <input class="hf-input" id="hf-msg-input" type="text" placeholder="Feedback..." maxlength="300"/>
        <button class="hf-send" id="hf-send-btn">Send</button>
      </div>
      <div class="hf-msg-note" id="hf-msg-note">‼️Not currently developed, for now email me at mail@rajatcj.com</div>
    </div>


      <div class="hf-bottom">
        <span>© 2026 Clinical Simulation · By <a href="https://rajatcj.com/?clicsimfooter" target="_blank" class="hf-link-inline">Rajat CJ</a></span>
        <span>Educational use only</span>
      </div>
  </div>
</footer>
`;

document.addEventListener("DOMContentLoaded", () => {
  document.body.insertAdjacentHTML("beforeend", footerHTML);
});