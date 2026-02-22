import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function formatDateLong(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function formatTime12(time24: string): string {
  const [h, m] = time24.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const hour = h % 12 || 12;
  return `${hour}:${m.toString().padStart(2, "0")} ${ampm}`;
}

// Redirect to the static cancel.html page with a status message
function redirectTo(baseUrl: string, params: Record<string, string>): Response {
  const url = new URL(baseUrl);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  return Response.redirect(url.toString(), 302);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Base URL for the cancel result page — served from GitHub Pages
  // Falls back to a Supabase-hosted URL if not set
  const cancelPageBase = Deno.env.get("CANCEL_PAGE_URL") ?? "https://king-tuerto.github.io/Office-Scheduling/cancel.html";

  try {
    let token: string | null = null;

    if (req.method === "GET") {
      const url = new URL(req.url);
      token = url.searchParams.get("token");
    } else {
      const body = await req.json();
      token = body.token;
    }

    if (!token) {
      return redirectTo(cancelPageBase, { status: "invalid" });
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: booking, error: fetchError } = await supabaseAdmin
      .from("bookings")
      .select("*")
      .eq("cancel_token", token)
      .single();

    if (fetchError || !booking) {
      return redirectTo(cancelPageBase, { status: "notfound" });
    }

    const formattedDate = formatDateLong(booking.booking_date);
    const formattedTime = formatTime12(booking.booking_time.slice(0, 5));

    // Enforce 2-hour rule (Phoenix = UTC-7)
    const appointmentLocal = new Date(booking.booking_date + "T" + booking.booking_time.slice(0, 5) + ":00");
    const appointmentUTC = new Date(appointmentLocal.getTime() + 7 * 60 * 60 * 1000);
    const twoHoursFromNow = new Date(Date.now() + 2 * 60 * 60 * 1000);

    if (appointmentUTC <= twoHoursFromNow) {
      return redirectTo(cancelPageBase, {
        status: "toolate",
        date: formattedDate,
        time: formattedTime,
      });
    }

    // Send cancellation email
    const resendKey = Deno.env.get("RESEND_API_KEY")!;
    const emailPayload = {
      from: "Office Hours <officehours@tv-mexico.com>",
      to: [booking.email],
      subject: `Office Hours Appointment Cancelled — ${formattedDate}`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #742a2a;">Your appointment has been cancelled</h2>
          <p>Hi ${booking.student_name},</p>
          <p>Your office hours appointment has been cancelled as requested:</p>
          <table style="border-collapse: collapse; width: 100%; margin: 20px 0;">
            <tr><td style="padding: 8px; font-weight: bold; width: 120px;">Date</td><td style="padding: 8px;">${formattedDate}</td></tr>
            <tr style="background:#f7fafc;"><td style="padding: 8px; font-weight: bold;">Time</td><td style="padding: 8px;">${formattedTime}</td></tr>
            <tr><td style="padding: 8px; font-weight: bold;">Location</td><td style="padding: 8px;">CCOB 42-125</td></tr>
          </table>
          <p>The slot is now available for other students. If you would like to rebook, please visit the booking page or contact Prof. Waterman at
             <a href="mailto:paul.waterman@gcu.edu">paul.waterman@gcu.edu</a>.</p>
          <p style="color: #718096; font-size: 0.9em;">Waterman Office Hours - CCOB 42-125 - Grand Canyon University</p>
        </div>
      `,
    };

    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(emailPayload),
    });

    // Delete the booking
    const { error: deleteError } = await supabaseAdmin
      .from("bookings")
      .delete()
      .eq("cancel_token", token);

    if (deleteError) throw deleteError;

    return redirectTo(cancelPageBase, {
      status: "success",
      date: formattedDate,
      time: formattedTime,
      email: booking.email,
    });

  } catch (err) {
    console.error("cancel-booking error:", err);
    return redirectTo(cancelPageBase, { status: "error" });
  }
});
