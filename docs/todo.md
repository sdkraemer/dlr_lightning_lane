1. Update currently reserved time selection to start at park hours, and end at park hours
2. Rmoved the currently reserved end time, this is always implied one hour after the start time.
3. Default desired end time to +1 hour after desired start time when desired start time is updated.
4. If booking currently offered is in return desired window, its not making it apparent and indicating to the user to take action.
5. The wait time can jump around. We should show the currently offered time, but also show the farthest out booking time. So the offered time may currently show 3:00pm, but at one point we saw 5:00pm, so 5:00pm is the more realistic time and should be used for the status of if we're in the window or not. 