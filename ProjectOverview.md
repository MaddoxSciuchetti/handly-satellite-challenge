Backend:

socket connection -> convex
automatic detection of the points that are connected with one another
specify one or two lengths that than calculate the length also for other areas

Frontend:

-remove bad edges manually (the user can do this)
-Interaction with a real interactive canvas
-Connect dots in frontend (existing dots,reuse the dot for other edges, clicking on new
edge connects to the existing dot)
-Goal is to have a precise area
-submit task with id etc status: in progress,
-status gets updated in the db from vlad
-status with new points
-Show multiple pictures to approximate the overall angle

Focus:

-How dots are being moved
-How dots are connected to reality

Dots on image:

What is returned:

-Array of dots
-Index of dots

Main Goals: Get a high precision area

Whenever status switches to done than create another mutation that fetches than everything for that created task (which is all of the coordinates etc). obviously thsi should work with optimistic updates
