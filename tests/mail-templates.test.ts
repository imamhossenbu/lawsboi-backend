import { describe, expect, it } from "vitest";
import { inviteMail } from "../src/lib/mail/templates/invite.js";
import { otpMail } from "../src/lib/mail/templates/otp.js";
import { ticketReplyMail } from "../src/lib/mail/templates/ticket.js";

describe("mail templates", () => {
  it("puts the code in the subject and escapes html", () => {
    const m = otpMail("123456", "signup", "bn");
    expect(m.subject).toContain("123456");
    expect(m.html).toContain('lang="bn"');
  });

  it("fills the invitation in the right language", () => {
    const m = inviteMail({ name: "Nadia", role: "support", inviter: "Imam", password: "k7Rm4pXw2Qn9", signInUrl: "http://localhost:3001/login" }, "en");
    expect(m.subject).toBe("Imam invited you to the Lawsboi admin panel");
    expect(m.text).toContain("Support agent");
    expect(m.html).toContain("k7Rm4pXw2Qn9");
  });

  it("keeps line breaks and escapes the reply", () => {
    const m = ticketReplyMail({ id: "TKT-000001", subject: "PDF <b>", agent: "Farhana", body: "Line one\nLine <two>", ticketUrl: "http://x/t" }, "en");
    expect(m.subject).toBe("Re: PDF <b> [TKT-000001]");
    expect(m.html).toContain("Line one<br>Line &lt;two&gt;");
  });
});
