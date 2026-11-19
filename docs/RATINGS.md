# Rating settings

Open **Admin → Tools → Player ratings** to change the settings for the whole
instance. Computed scores are on and peer ratings are set to Everyone by default.

| Rating mode | Rating used in Rankings and balanced team drafts |
| --- | --- |
| Computed scores off | **Base Rating**, the initial rating set by an admin or workbook import. |
| Computed scores on | **Adjusted Rating**, the blend of Base Rating, eligible peer votes, and player attributes. |

The Player Profile shows Base Rating and Adjusted Rating together. Turning
computation off disables Adjusted Rating and automatic attribute scores. PAC
and DRI still inform balanced team drafts in both modes. Setting Base Rating
in the admin player editor changes the seed used by both modes.

| Peer ratings setting | Who can rate whom |
| --- | --- |
| Off | Voting and rating reminders are disabled. Stored votes are retained. |
| Teammates only | Confirmed attendees can rate teammates they shared a side with in a completed match. A side includes its live substitutes. |
| Everyone | Confirmed attendees can rate any other confirmed attendee in that meetup. |

An eligible vote is one to five stars. At least three different eligible
people must rate the same player in the same meetup before those votes can
affect Adjusted Rating. Clearing a vote can bring the count below three.
Changing the peer setting applies the new eligibility rules to existing
votes when calculating Adjusted Rating.

See [Team balancing](TEAM_BALANCING.md) for the blend weights, attendance
deduction, attribute formulas, and team assignment rules.
