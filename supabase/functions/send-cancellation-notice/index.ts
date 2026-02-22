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

async function getMSAccessToken(supabaseAdmin: ReturnType<typeof createClient>): Promise<string> {
  const tenantId = Deno.env.get("MS_TENANT_ID")!;
  const clientId = Deno.env.get("MS_CLIENT_ID")!;
  const clientSecret = Deno.env.get("MS_CLIENT_SECRET")!;

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
  if (!tokens.access_token) throw new Error("Failed to get MS access token");

  if (tokens.refresh_token) {
    await supabaseAdmin
      .from("app_secrets")
      .update({ value: tokens.refresh_token, updated_at: new Date().toISOString() })
      .eq("key", "ms_refresh_token");
  }

  return tokens.access_token;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { bookingId, adminPassword } = await req.json();

    // Validate admin password
    if (adminPassword !== Deno.env.get("ADMIN_PASSWORD")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!bookingId) {
      return new Response(JSON.stringify({ error: "Missing bookingId" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Fetch the booking record
    const { data: booking, error: fetchError } = await supabaseAdmin
      .from("bookings")
      .select("*")
      .eq("id", bookingId)
      .single();

    if (fetchError || !booking) {
      return new Response(JSON.stringify({ error: "Booking not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── 1. Send cancellation email (skip for admin-blocked slots) ─────────────
    if (!booking.is_admin_block && booking.email && booking.email !== "N/A") {
      const resendKey = Deno.env.get("RESEND_API_KEY")!;
      const formattedDate = formatDateLong(booking.booking_date);
      const formattedTime = formatTime12(booking.booking_time.slice(0, 5));

      const emailPayload = {
        from: "Office Hours <officehours@tv-mexico.com>",
        to: [booking.email],
        subject: `Office Hours Appointment Cancelled — ${formattedDate}`,
        html: `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #742a2a;">Your appointment has been cancelled</h2>
            <p>Hi ${booking.student_name},</p>
            <p>Your office hours appointment has been cancelled by Prof. Waterman:</p>
            <table style="border-collapse: collapse; width: 100%; margin: 20px 0;">
              <tr><td style="padding: 8px; font-weight: bold; width: 120px;">Date</td><td style="padding: 8px;">${formattedDate}</td></tr>
              <tr style="background:#f7fafc;"><td style="padding: 8px; font-weight: bold;">Time</td><td style="padding: 8px;">${formattedTime}</td></tr>
              <tr><td style="padding: 8px; font-weight: bold;">Location</td><td style="padding: 8px;">CCOB 42-125</td></tr>
            </table>
            <p>Please rebook at your convenience at the booking page, or contact Prof. Waterman directly at
               <a href="mailto:paul.waterman@gcu.edu">paul.waterman@gcu.edu</a>.</p>
            <p style="color: #718096; font-size: 0.9em;">Waterman Office Hours · CCOB 42-125 · Grand Canyon University</p>
          </div>
        `,
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
        console.error("Resend cancellation email error:", await emailRes.text());
      }
    }

    // ── 2. Delete Outlook calendar event ──────────────────────────────────────
    if (booking.outlook_event_id) {
      try {
        const accessToken = await getMSAccessToken(supabaseAdmin);
        const userEmail = Deno.env.get("MS_USER_EMAIL")!;

        const deleteRes = await fetch(
          `https://graph.microsoft.com/v1.0/users/${userEmail}/calendar/events/${booking.outlook_event_id}`,
          {
            method: "DELETE",
            headers: { "Authorization": `Bearer ${accessToken}` },
          }
        );

        if (!deleteRes.ok && deleteRes.status !== 404) {
          console.error("Graph delete error:", await deleteRes.text());
        }
      } catch (calErr) {
        // Don't fail the whole cancellation if calendar delete fails
        console.error("Outlook calendar delete error:", calErr);
      }
    }

    // ── 3. Delete the booking row ─────────────────────────────────────────────
    const { error: deleteError } = await supabaseAdmin
      .from("bookings")
      .delete()
      .eq("id", bookingId);

    if (deleteError) throw deleteError;

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("send-cancellation-notice error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
