import { google } from 'googleapis';
import { callWithRetry } from './API-Calls.js';

/**
 * Calendar Scanner Module
 * Analyzes Google Calendar data for workspace migration planning
 */
export class CalendarScanner {
  constructor(auth) {
    this.calendar = google.calendar({ version: 'v3', auth });
    this.primaryDomain = process.env.PRIMARY_DOMAIN;
  }

  /**
   * Scans all calendars for a specific user
   * @param {string} userEmail - Email of the user to scan
   * @returns {Object} Migration analysis data
   */
  async scanUserCalendars(userEmail) {
    const migrationIssues = {
      userEmail,
      calendars: [],
      futureEvents: [],
      recurringEvents: [],
      externalAttendees: [],
      crossTenantMeetings: [],
      migrationRisks: {
        totalFutureEvents: 0,
        totalRecurringEvents: 0,
        totalExternalMeetings: 0,
        totalPublicEvents: 0
      }
    };

    try {
      console.log(`Scanning calendars for ${userEmail}...`);
      
      // Get all calendars for user
      const calendarListResponse = await callWithRetry(async () => {
        return await this.calendar.calendarList.list();
      });
      
      if (!calendarListResponse.data.items) {
        console.log(`No calendars found for ${userEmail}`);
        return migrationIssues;
      }

      for (const cal of calendarListResponse.data.items) {
        console.log(`  Analyzing calendar: ${cal.summary}`);
        
        const calendarData = await this.analyzeCalendar(cal);
        migrationIssues.calendars.push(calendarData);
        
        // Analyze events in this calendar
        const events = await this.scanCalendarEvents(cal.id);
        migrationIssues.futureEvents.push(...events.future);
        migrationIssues.recurringEvents.push(...events.recurring);
        migrationIssues.externalAttendees.push(...events.external);
        migrationIssues.crossTenantMeetings.push(...events.crossTenant);
      }

      // Calculate migration risks
      migrationIssues.migrationRisks = {
        totalFutureEvents: migrationIssues.futureEvents.length,
        totalRecurringEvents: migrationIssues.recurringEvents.length,
        totalExternalMeetings: migrationIssues.externalAttendees.length,
        totalPublicEvents: migrationIssues.futureEvents.filter(e => e.visibility === 'public').length
      };

    } catch (error) {
      console.error(`Error scanning calendars for ${userEmail}:`, error.message);
      migrationIssues.error = error.message;
    }

    return migrationIssues;
  }

  /**
   * Analyzes a single calendar for migration issues
   * @param {Object} calendar - Google Calendar object
   * @returns {Object} Calendar analysis data
   */
  async analyzeCalendar(calendar) {
    return {
      id: calendar.id,
      name: calendar.summary,
      isPrimary: calendar.primary || false,
      accessRole: calendar.accessRole,
      isShared: calendar.accessRole !== 'owner',
      isExternal: calendar.id.includes('@') && !calendar.id.includes(this.primaryDomain),
      backgroundColor: calendar.backgroundColor,
      foregroundColor: calendar.foregroundColor,
      selected: calendar.selected,
      migrationRisk: this.assessCalendarMigrationRisk(calendar)
    };
  }

  /**
   * Assesses migration risk for a calendar
   * @param {Object} calendar - Google Calendar object
   * @returns {string} Risk level (low, medium, high)
   */
  assessCalendarMigrationRisk(calendar) {
    if (calendar.accessRole === 'reader' || calendar.accessRole === 'freeBusyReader') {
      return 'low';
    }
    if (calendar.accessRole === 'writer' || calendar.accessRole === 'editor') {
      return 'medium';
    }
    if (calendar.accessRole === 'owner' && calendar.primary) {
      return 'high';
    }
    return 'medium';
  }

  /**
   * Scans events in a specific calendar
   * @param {string} calendarId - Calendar ID to scan
   * @returns {Object} Categorized events
   */
  async scanCalendarEvents(calendarId) {
    const now = new Date();
    const futureDate = new Date();
    futureDate.setFullYear(now.getFullYear() + 2); // Look 2 years ahead

    const events = {
      future: [],
      recurring: [],
      external: [],
      crossTenant: []
    };

    try {
      const response = await callWithRetry(async () => {
        return await this.calendar.events.list({
          calendarId,
          timeMin: now.toISOString(),
          timeMax: futureDate.toISOString(),
          maxResults: 2500,
          singleEvents: false, // Include recurring event instances
          fields: 'items(id,summary,start,end,recurrence,attendees,hangoutLink,visibility,organizer,creator)'
        });
      });

      if (!response.data.items) {
        return events;
      }

      for (const event of response.data.items) {
        const analysis = this.analyzeEvent(event, calendarId);
        
        if (analysis.isFuture) events.future.push(analysis);
        if (analysis.isRecurring) events.recurring.push(analysis);
        if (analysis.hasExternalAttendees) events.external.push(analysis);
        if (analysis.hasCrossTenantMeeting) events.crossTenant.push(analysis);
      }

    } catch (error) {
      console.error(`Error scanning events for calendar ${calendarId}:`, error.message);
    }

    return events;
  }

  /**
   * Analyzes a single calendar event for migration issues
   * @param {Object} event - Google Calendar event
   * @param {string} calendarId - Calendar ID containing the event
   * @returns {Object} Event analysis data
   */
  analyzeEvent(event, calendarId) {
    const startTime = event.start?.dateTime || event.start?.date;
    const endTime = event.end?.dateTime || event.end?.date;
    
    const analysis = {
      id: event.id,
      calendarId,
      summary: event.summary || 'Untitled Event',
      start: startTime,
      end: endTime,
      isFuture: new Date(startTime) > new Date(),
      isRecurring: !!event.recurrence,
      recurrenceRule: event.recurrence?.[0],
      hasExternalAttendees: false,
      hasCrossTenantMeeting: false,
      externalDomains: [],
      attendeeCount: event.attendees?.length || 0,
      hasGoogleMeet: !!event.hangoutLink,
      meetingRooms: [],
      visibility: event.visibility || 'default',
      organizer: event.organizer?.email,
      creator: event.creator?.email,
      migrationComplexity: 'low'
    };

    // Analyze attendees for external domains
    if (event.attendees) {
      for (const attendee of event.attendees) {
        if (attendee.email) {
          const domain = attendee.email.split('@')[1];
          
          // Check for external attendees
          if (domain && domain !== this.primaryDomain) {
            analysis.hasExternalAttendees = true;
            if (!analysis.externalDomains.includes(domain)) {
              analysis.externalDomains.push(domain);
            }
          }
          
          // Check for meeting rooms
          if (attendee.email.includes('resource.calendar.google.com')) {
            analysis.meetingRooms.push(attendee.email);
          }
        }
      }
    }

    // Assess migration complexity
    analysis.migrationComplexity = this.assessEventMigrationComplexity(analysis);

    return analysis;
  }

  /**
   * Assesses the complexity of migrating a specific event
   * @param {Object} eventAnalysis - Event analysis data
   * @returns {string} Complexity level (low, medium, high)
   */
  assessEventMigrationComplexity(eventAnalysis) {
    let complexity = 'low';

    if (eventAnalysis.isRecurring) complexity = 'medium';
    if (eventAnalysis.hasExternalAttendees) complexity = 'medium';
    if (eventAnalysis.hasGoogleMeet) complexity = 'medium';
    if (eventAnalysis.meetingRooms.length > 0) complexity = 'high';
    if (eventAnalysis.isRecurring && eventAnalysis.hasExternalAttendees) complexity = 'high';
    if (eventAnalysis.visibility === 'public') complexity = 'high';

    return complexity;
  }

  /**
   * Generates a summary report of calendar migration issues
   * @param {Array} calendarAnalysisResults - Array of calendar analysis results
   * @returns {Object} Summary report
   */
  generateMigrationSummary(calendarAnalysisResults) {
    const summary = {
      totalUsers: calendarAnalysisResults.length,
      totalCalendars: 0,
      totalFutureEvents: 0,
      totalRecurringEvents: 0,
      totalExternalMeetings: 0,
      highRiskEvents: 0,
      mediumRiskEvents: 0,
      lowRiskEvents: 0,
      externalDomains: new Set(),
      migrationRecommendations: []
    };

    for (const userAnalysis of calendarAnalysisResults) {
      if (userAnalysis.error) continue;

      summary.totalCalendars += userAnalysis.calendars.length;
      summary.totalFutureEvents += userAnalysis.futureEvents.length;
      summary.totalRecurringEvents += userAnalysis.recurringEvents.length;
      summary.totalExternalMeetings += userAnalysis.externalAttendees.length;

      // Count complexity levels
      for (const event of userAnalysis.futureEvents) {
        switch (event.migrationComplexity) {
          case 'high': summary.highRiskEvents++; break;
          case 'medium': summary.mediumRiskEvents++; break;
          case 'low': summary.lowRiskEvents++; break;
        }

        // Collect external domains
        event.externalDomains.forEach(domain => summary.externalDomains.add(domain));
      }
    }

    // Generate recommendations
    if (summary.totalRecurringEvents > 50) {
      summary.migrationRecommendations.push('Consider migrating recurring events manually due to high volume');
    }
    if (summary.externalDomains.size > 10) {
      summary.migrationRecommendations.push('High number of external domains detected - coordinate with external partners');
    }
    if (summary.highRiskEvents > 100) {
      summary.migrationRecommendations.push('Many high-risk events detected - consider phased migration approach');
    }

    // Convert Set to Array for JSON serialization
    summary.externalDomains = Array.from(summary.externalDomains);

    return summary;
  }
}

export default CalendarScanner;
