// Google Calendar API Integration for Google Meet Link Generation
import { google } from 'googleapis';
import path from 'path';
import { fileURLToPath } from 'url';
import { IAppointment } from '../models/Appointment.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get Google Calendar config
const getGoogleCalendarConfig = () => {
  const serviceAccountKeyPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH || 
    path.join(__dirname, '../../auxin-473216-38038b443ee2.json');
  
  const calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary';
  
  // Domain-Wide Delegation: Impersonate a Workspace user
  // Set GOOGLE_WORKSPACE_USER_EMAIL to enable (e.g., 'sales@yourdomain.com')
  const workspaceUserEmail = process.env.GOOGLE_WORKSPACE_USER_EMAIL;
  
  return {
    serviceAccountKeyPath,
    calendarId,
    workspaceUserEmail
  };
};

// Initialize Google Calendar API client
const getCalendarClient = async () => {
  const config = getGoogleCalendarConfig();
  
  try {
    const authOptions: any = {
      keyFile: config.serviceAccountKeyPath,
      scopes: ['https://www.googleapis.com/auth/calendar'],
    };

    // 🥇 FIX 1: Domain-Wide Delegation (WORKSPACE)
    // If workspace user email is set, impersonate that user
    // This allows service account to create Meet links
    if (config.workspaceUserEmail) {
      console.log('🏢 Using Domain-Wide Delegation for:', config.workspaceUserEmail);
      authOptions.subject = config.workspaceUserEmail;
    } else {
      console.warn('⚠️ GOOGLE_WORKSPACE_USER_EMAIL not set. Meet links may not work with personal Gmail.');
      console.warn('⚠️ Set GOOGLE_WORKSPACE_USER_EMAIL=your-workspace-email@yourdomain.com to enable Meet links');
    }

    const auth = new google.auth.GoogleAuth(authOptions);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const calendar = google.calendar({ version: 'v3', auth: auth as any });
    
    return { calendar, calendarId: config.calendarId };
  } catch (error: any) {
    console.error('❌ Error initializing Google Calendar client:', error);
    throw new Error(`Failed to initialize Google Calendar: ${error.message}`);
  }
};

// Create Google Meet event for appointment
export const createGoogleMeetEvent = async (appointment: IAppointment): Promise<{
  googleMeetLink: string;
  googleCalendarEventId: string;
}> => {
  try {
    const { calendar, calendarId } = await getCalendarClient();
    
    // Verify calendar supports conferences (optional check, but helpful for debugging)
    try {
      const calendarInfo = await calendar.calendars.get({
        calendarId: calendarId,
      });
      const allowedTypes = calendarInfo.data.conferenceProperties?.allowedConferenceSolutionTypes || [];
      console.log('📋 Calendar conference types:', allowedTypes.length > 0 ? allowedTypes : 'none (Meet may not be enabled)');
      
      if (allowedTypes.length === 0) {
        console.warn('⚠️ Calendar does not appear to have any conference types enabled. Meet may not work.');
      }
    } catch (checkError: any) {
      console.warn('⚠️ Could not check calendar properties:', checkError.message);
      // Continue anyway - sometimes this check fails but Meet still works
    }
    
    // Calculate start and end times
    const dateStr = appointment.date instanceof Date ? 
      appointment.date.toISOString().split('T')[0] : 
      appointment.date;
    
    const startDateTime = new Date(`${dateStr}T${appointment.time}:00`);
    const durationMinutes = 60; // Default 60 minutes for appointments
    const endDateTime = new Date(startDateTime.getTime() + durationMinutes * 60000);
    
    const timezone = appointment.timezone || 'UTC';
    
    console.log('📅 Creating Google Calendar event:', {
      date: dateStr,
      time: appointment.time,
      startDateTime: startDateTime.toISOString(),
      endDateTime: endDateTime.toISOString(),
      timezone,
      userName: appointment.userName,
      userEmail: appointment.userEmail
    });

    // Create event WITHOUT conferenceSolutionKey - Google will auto-detect and create Meet link
    // Specifying conferenceSolutionKey.type causes "Invalid conference type value" error
    const event = {
      summary: `Meeting with ${appointment.userName}`,
      description: `Scheduled meeting with ${appointment.userName} (${appointment.userEmail})\nDuration: ${durationMinutes} minutes\n\nMeeting Link: Will be provided separately`,
      start: {
        dateTime: startDateTime.toISOString(),
        timeZone: timezone,
      },
      end: {
        dateTime: endDateTime.toISOString(),
        timeZone: timezone,
      },
      conferenceData: {
        createRequest: {
          requestId: `meet-${appointment._id}-${Date.now()}`,
          conferenceSolutionKey: {
            type: 'hangoutsMeet',
          },
        },
      },
      // Note: Service accounts cannot add attendees without Domain-Wide Delegation
      // The user email is included in the description instead
    };

    console.log('📅 Creating Google Calendar event:', {
      summary: event.summary,
      start: event.start.dateTime,
      end: event.end.dateTime,
      hasConferenceData: !!event.conferenceData,
      note: 'conferenceSolutionKey omitted - Google will auto-detect',
    });

    const response = await calendar.events.insert({
      calendarId: calendarId,
      conferenceDataVersion: 1,
      requestBody: event,
    });

    // Extract Meet link from multiple possible locations
    const googleMeetLink = response.data.hangoutLink || 
                          response.data.conferenceData?.entryPoints?.[0]?.uri || 
                          '';
    const googleCalendarEventId = response.data.id || '';

    console.log('✅ Google Calendar event created:', {
      eventId: googleCalendarEventId,
      hangoutLink: response.data.hangoutLink,
      conferenceData: response.data.conferenceData,
      extractedMeetLink: googleMeetLink ? googleMeetLink.substring(0, 50) + '...' : 'none'
    });

    if (!googleMeetLink) {
      console.warn('⚠️ No Meet link in initial response, fetching event to check...');
      
      // Try fetching the event again - sometimes the Meet link appears after a short delay
      try {
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
        
        const fetchedEvent = await calendar.events.get({
          calendarId: calendarId,
          eventId: googleCalendarEventId,
        });
        
        const fetchedMeetLink = fetchedEvent.data.hangoutLink || 
                               fetchedEvent.data.conferenceData?.entryPoints?.[0]?.uri || 
                               '';
        
        if (fetchedMeetLink) {
          console.log('✅ Meet link found after fetching event:', fetchedMeetLink.substring(0, 50) + '...');
          return {
            googleMeetLink: fetchedMeetLink,
            googleCalendarEventId: googleCalendarEventId
          };
        }
      } catch (fetchError: any) {
        console.warn('⚠️ Could not fetch event:', fetchError.message);
      }
      
      console.error('❌ No Meet link found in response:', {
        hangoutLink: response.data.hangoutLink,
        conferenceData: response.data.conferenceData,
        eventId: googleCalendarEventId,
        htmlLink: response.data.htmlLink
      });
      
      // Provide helpful error message
      throw new Error(
        'Google Meet link not generated. ' +
        'Please ensure Google Meet is enabled on the calendar and the service account has proper permissions. ' +
        `Event created: ${response.data.htmlLink}`
      );
    }

    console.log('✅ Google Meet event created:', {
      eventId: googleCalendarEventId,
      meetLink: googleMeetLink.substring(0, 50) + '...'
    });

    return {
      googleMeetLink,
      googleCalendarEventId
    };
  } catch (error: any) {
    console.error('❌ Error creating Google Meet event:', error);
    console.error('❌ Error details:', {
      message: error.message,
      code: error.code,
      status: error.status,
      response: error.response?.data
    });
    
    // Check if it's an "Invalid conference type" error
    if (error.message?.includes('Invalid conference type') || 
        error.message?.includes('conference type') ||
        error.response?.data?.error?.message?.includes('conference type')) {
      throw new Error(
        'Google Calendar API rejected conference type. ' +
        'Please ensure Google Meet is enabled on the calendar. ' +
        'Go to Google Calendar Settings → Event settings → Enable "Add Google Meet video conferencing"'
      );
    }
    
    throw error;
  }
};

// Generate new Meet link for existing calendar event
export const generateNewMeetLink = async (appointment: IAppointment): Promise<string> => {
  try {
    const { calendar, calendarId } = await getCalendarClient();
    
    if (!appointment.googleCalendarEventId) {
      // If no calendar event exists, create a new one
      console.log('📅 No existing calendar event, creating new one...');
      const meetData = await createGoogleMeetEvent(appointment);
      
      // Update appointment with calendar event ID
      appointment.googleCalendarEventId = meetData.googleCalendarEventId;
      await appointment.save();
      
      return meetData.googleMeetLink;
    }

    // Try to update existing event with new conference
    // If this fails (e.g., due to invalid conference type), we'll create a new event
    try {
      console.log('🔄 Updating existing calendar event with new conference...');
      const event = {
        conferenceData: {
          createRequest: {
            requestId: `meet-${appointment._id}-${Date.now()}`,
            conferenceSolutionKey: {
              type: 'hangoutsMeet',
            },
          },
        },
        // Explicitly exclude attendees to avoid permission issues
        attendees: undefined,
      };

      const response = await calendar.events.patch({
        calendarId: calendarId,
        eventId: appointment.googleCalendarEventId,
        conferenceDataVersion: 1,
        requestBody: event,
      });

      // Extract Meet link from multiple possible locations
      const googleMeetLink = response.data.hangoutLink || 
                            response.data.conferenceData?.entryPoints?.[0]?.uri || 
                            '';

      if (googleMeetLink) {
        console.log('✅ New Google Meet link generated from existing event:', {
          meetLink: googleMeetLink.substring(0, 50) + '...',
          hangoutLink: response.data.hangoutLink,
          conferenceData: response.data.conferenceData
        });
        return googleMeetLink;
      } else {
        console.warn('⚠️ No Meet link in patch response, will create new event');
        throw new Error('No Meet link generated from patch');
      }
    } catch (patchError: any) {
      console.warn('⚠️ Failed to patch existing event, creating new one:', {
        message: patchError.message,
        code: patchError.code,
        status: patchError.status
      });
      
      // If patching fails (e.g., due to invalid conference type, attendees permission, etc.), create a new event
      if (patchError.message?.includes('Domain-Wide Delegation') || 
          patchError.message?.includes('attendees') ||
          patchError.message?.includes('Invalid conference type') ||
          patchError.message?.includes('conference type')) {
        console.log('📅 Creating new event due to error with existing event...');
        const meetData = await createGoogleMeetEvent(appointment);
        
        // Update appointment with new calendar event ID
        appointment.googleCalendarEventId = meetData.googleCalendarEventId;
        await appointment.save();
        
        return meetData.googleMeetLink;
      }
      
      // Re-throw if it's a different error
      throw patchError;
    }

    throw new Error('Google Meet link not generated in response');
  } catch (error: any) {
    console.error('❌ Error generating new Meet link:', error);
    console.error('❌ Error details:', {
      message: error.message,
      code: error.code,
      status: error.status,
      response: error.response?.data
    });
    
    // If we get an "Invalid conference type" error, try creating a new event as fallback
    if (error.message?.includes('Invalid conference type') || 
        error.message?.includes('conference type') ||
        error.response?.data?.error?.message?.includes('conference type')) {
      console.log('🔄 Fallback: Creating new event due to conference type error...');
      try {
        const meetData = await createGoogleMeetEvent(appointment);
        appointment.googleCalendarEventId = meetData.googleCalendarEventId;
        await appointment.save();
        return meetData.googleMeetLink;
      } catch (fallbackError: any) {
        console.error('❌ Fallback also failed:', fallbackError);
        throw new Error(`Failed to generate Meet link: ${fallbackError.message}`);
      }
    }
    
    throw error;
  }
};

// Validate Google Calendar setup
export const validateGoogleCalendarSetup = async (): Promise<boolean> => {
  try {
    const config = getGoogleCalendarConfig();
    
    // Check if service account key file exists
    const fs = await import('fs/promises');
    try {
      await fs.access(config.serviceAccountKeyPath);
    } catch {
      console.error(`❌ Service account key file not found: ${config.serviceAccountKeyPath}`);
      return false;
    }

    // Try to initialize client
    await getCalendarClient();
    
    console.log('✅ Google Calendar setup validated');
    return true;
  } catch (error: any) {
    console.error('❌ Google Calendar setup validation failed:', error.message);
    return false;
  }
};



