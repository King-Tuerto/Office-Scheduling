import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatDateLong(dateStr: string): string {
  // dateStr is "YYYY-MM-DD"
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function formatTime12(time24: string): string {
  // time24 is "HH:MM"
  const [h, m] = time24.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const hour = h % 12 || 12;
  return `${hour}:${m.toString().padStart(2, "0")} ${ampm}`;
}

function addMinutesToTime(time24: string, minutes: number): string {
  const [h, m] = time24.split(":").map(Number);
  const total = h * 60 + m + minutes;
  const newH = Math.floor(total / 60) % 24;
  const newM = total % 60;
  return `${newH.toString().padStart(2, "0")}:${newM.toString().padStart(2, "0")}`;
}

function generateICS(params: {
  name: string;
  date: string;       // "YYYY-MM-DD"
  startTime: string;  // "HH:MM"
  endTime: string;    // "HH:MM"
  uid: string;
}): string {
  // GCU is in Phoenix, AZ — no daylight saving (always MST = UTC-7)
  const dateStr = params.date.replace(/-/g, "");
  const startStr = params.startTime.replace(":", "") + "00";
  const endStr = params.endTime.replace(":", "") + "00";
  const now = new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15) + "Z";

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Waterman Office Hours//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `DTSTART;TZID=America/Phoenix:${dateStr}T${startStr}`,
    `DTEND;TZID=America/Phoenix:${dateStr}T${endStr}`,
    `DTSTAMP:${now}`,
    `UID:${params.uid}@officehours.waterman.gcu`,
    `SUMMARY:Office Hours - Prof. Waterman`,
    "LOCATION:CCOB 42-125",
    `DESCRIPTION:Office hours appointment for ${params.name}.\\nLocation: CCOB 42-125\\nTo cancel\\, please do so at least 18 hours in advance.`,
    "STATUS:CONFIRMED",
    "BEGIN:VALARM",
    "TRIGGER:-PT1H",
    "ACTION:DISPLAY",
    "DESCRIPTION:Office hours appointment in 1 hour",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

// ── Microsoft Graph helpers ───────────────────────────────────────────────────

async function getMSAccessToken(supabaseAdmin: ReturnType<typeof createClient>): Promise<string> {
  const tenantId = Deno.env.get("MS_TENANT_ID")!;
  const clientId = Deno.env.get("MS_CLIENT_ID")!;
  const clientSecret = Deno.env.get("MS_CLIENT_SECRET")!;

  // Read refresh token from DB (rotated after every use)
  const { data, error } = await supabaseAdmin
    .from("app_secrets")
    .select("value")
    .eq("key", "ms_refresh_token")
    .single();

  if (error || !data) throw new Error("Could not read MS refresh token from DB");

  const tokenRes = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: data.value,
        grant_type: "refresh_token",
        scope: "Calendars.ReadWrite offline_access",
      }),
    }
  );

  const tokens = await tokenRes.json();
  if (!tokens.access_token) throw new Error("Failed to get MS access token: " + JSON.stringify(tokens));

  // Rotate the refresh token — Microsoft returns a new one each time
  if (tokens.refresh_token) {
    await supabaseAdmin
      .from("app_secrets")
      .update({ value: tokens.refresh_token, updated_at: new Date().toISOString() })
      .eq("key", "ms_refresh_token");
  }

  return tokens.access_token;
}

async function createOutlookEvent(
  accessToken: string,
  booking: {
    name: string;
    email: string;
    phone: string;
    classTime: string;
    date: string;
    startTime: string;
    endTime: string;
  }
): Promise<string | null> {
  const userEmail = Deno.env.get("MS_USER_EMAIL")!;

  const body = {
    subject: `Office Hours: ${booking.name}`,
    body: {
      contentType: "HTML",
      content: `
        <b>Student:</b> ${booking.name}<br>
        <b>Email:</b> ${booking.email}<br>
        <b>Phone:</b> ${booking.phone}<br>
        <b>Class Time:</b> ${booking.classTime}
      `,
    },
    start: {
      dateTime: `${booking.date}T${booking.startTime}:00`,
      timeZone: "America/Phoenix",
    },
    end: {
      dateTime: `${booking.date}T${booking.endTime}:00`,
      timeZone: "America/Phoenix",
    },
    location: { displayName: "CCOB 42-125" },
    reminderMinutesBeforeStart: 15,
    // Do NOT add student as attendee — avoids double-inviting them
  };

  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${userEmail}/calendar/events`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    console.error("Graph API error:", await res.text());
    return null;
  }

  const event = await res.json();
  return event.id ?? null;
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const {
      bookingId,
      name,
      email,
      phone,
      classTime,
      date,
      startTime,
      endTime,
    } = await req.json();

    if (!bookingId || !name || !email || !date || !startTime || !endTime) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const resendKey = Deno.env.get("RESEND_API_KEY")!;
    const endTimeComputed = endTime ?? addMinutesToTime(startTime, 30);
    const uid = crypto.randomUUID();

    // ── 0. Fetch cancel token from the booking row ────────────────────────────
    const { data: bookingRow } = await supabaseAdmin
      .from("bookings")
      .select("cancel_token")
      .eq("id", bookingId)
      .single();

    const cancelToken = bookingRow?.cancel_token ?? null;

    // ── 1. Generate .ics ──────────────────────────────────────────────────────
    const icsContent = generateICS({ name, date, startTime, endTime: endTimeComputed, uid });
    const icsBase64 = btoa(icsContent);

    // ── 2. Send confirmation email via Resend ─────────────────────────────────
    const formattedDate = formatDateLong(date);
    const formattedStart = formatTime12(startTime);
    const formattedEnd = formatTime12(endTimeComputed);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const cancelUrl = cancelToken
      ? `${supabaseUrl}/functions/v1/cancel-booking?token=${cancelToken}`
      : null;

    const cancelSection = cancelUrl
      ? `<p style="margin-top: 16px;">
           <a href="${cancelUrl}" style="display: inline-block; background: #fed7d7; color: #742a2a; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-weight: 600;">
             Cancel this appointment
           </a>
         </p>
         <p style="color: #718096; font-size: 0.85em; margin-top: 8px;">Cancellations must be made at least 2 hours before your appointment.</p>`
      : `<p>To cancel, contact Prof. Waterman at <a href="mailto:paul.waterman@gcu.edu">paul.waterman@gcu.edu</a> at least 2 hours in advance.</p>`;

    const emailPayload = {
      from: "Office Hours <officehours@tv-mexico.com>",
      to: [email],
      subject: `Office Hours Confirmed — ${formattedDate}`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #2d3748;">Your appointment is confirmed ✅</h2>
          <p>Hi ${name},</p>
          <p>Your office hours appointment with Prof. Waterman has been scheduled:</p>
          <table style="border-collapse: collapse; width: 100%; margin: 20px 0;">
            <tr><td style="padding: 8px; font-weight: bold; width: 120px;">Date</td><td style="padding: 8px;">${formattedDate}</td></tr>
            <tr style="background:#f7fafc;"><td style="padding: 8px; font-weight: bold;">Time</td><td style="padding: 8px;">${formattedStart} – ${formattedEnd}</td></tr>
            <tr><td style="padding: 8px; font-weight: bold;">Location</td><td style="padding: 8px;">CCOB 42-125</td></tr>
          </table>
          <p>A calendar invite is attached — click it to add this appointment to your calendar.</p>
          ${cancelSection}
          <p style="color: #718096; font-size: 0.9em; margin-top: 24px;">Waterman Office Hours · CCOB 42-125 · Grand Canyon University</p>
        </div>
      `,
      attachments: [
        {
          filename: "office-hours.ics",
          content: icsBase64,
        },
      ],
    };

    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(emailPayload),
    });

    if (!emailRes.ok) {
      console.error("Resend error:", await emailRes.text());
    }

    // ── 3. Create Outlook calendar event ─────────────────────────────────────
    let outlookEventId: string | null = null;
    try {
      const accessToken = await getMSAccessToken(supabaseAdmin);
      outlookEventId = await createOutlookEvent(accessToken, {
        name, email, phone, classTime, date, startTime, endTime: endTimeComputed,
      });
    } catch (calErr) {
      // Calendar failure does not fail the whole function — email already sent
      console.error("Outlook calendar error:", calErr);
    }

    // ── 4. Store outlook_event_id back on the booking row ────────────────────
    if (outlookEventId) {
      await supabaseAdmin
        .from("bookings")
        .update({ outlook_event_id: outlookEventId })
        .eq("id", bookingId);
    }

    return new Response(
      JSON.stringify({ success: true, calendarEventCreated: !!outlookEventId }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("send-booking-confirmation error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
