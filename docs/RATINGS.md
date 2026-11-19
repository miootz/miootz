# Rating settings

Open **Admin → Tools → Player ratings** to change the settings for the whole
instance. Computed scores are on and peer ratings are set to **Teammates only**
by default on new instances.

| Rating mode | Rating used in Rankings and balanced team drafts |
| --- | --- |
| Computed scores off | **Base Rating**, the initial rating set by an admin or workbook import. |
| Computed scores on | **Adjusted Rating**, the blend of Base Rating, eligible peer votes, and player attributes. |

The Player Profile shows Base Rating and Adjusted Rating together. Turning
computation off disables Adjusted Rating and automatic attribute scores. PAC
and DRI still inform balanced team drafts in both modes. Setting Base Rating
in the admin player editor changes the seed used by both modes.

Player attributes appear as whole numbers from **50 to 100**. Adjusted Rating
uses their underlying **1–5** scores before display rounding.

| Peer ratings setting | Who can rate whom |
| --- | --- |
| Off | Voting and rating reminders are disabled. Stored votes are retained. |
| Teammates only | Confirmed attendees can rate teammates they shared a side with in a completed match. A side includes its live substitutes. |
| Everyone | Confirmed attendees can rate any other confirmed attendee in that meetup. |

In Meetup History, tap an emoji to review a player.

| Review | Peer adjustment |
| --- | ---: |
| 😥 poor | −1.0 star |
| 😐 okay | 0.0 stars |
| 😏 good | +0.5 stars |
| 🤩 great | +1.0 star |

The **okay** review starts selected. Leaving it alone adds no vote. Tapping it
records a neutral vote. Tap your saved choice again to clear it.

At least three distinct eligible reviewers must vote for the same player
in a meetup before their votes count. An explicitly submitted neutral vote
counts toward those three. Miootz averages the votes within each meetup,
then halves their weight for every two finished, non-skipped meetups back.
Adjusted Rating adds 25% of the weighted peer adjustment to the rating
from Base and attributes.

History and profile averages show new emoji votes on a common star scale
of 2, 3, 3.5, and 4. Previously saved star votes keep their original values.
Changing the peer setting applies the new eligibility rules to existing
votes when calculating Adjusted Rating.

See [Team balancing](TEAM_BALANCING.md#base-rating-and-adjusted-rating) for the
blend weights, attendance deduction, attribute formulas, and team assignment rules.
