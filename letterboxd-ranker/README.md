# Reelsort

Rank the Letterboxd films you've watched but never rated, one "better or worse?" swipe at a time, and get half-star ratings you can import back into Letterboxd.

## Using it

1. On letterboxd.com: **Settings → Data → Export your data**. You get a `.zip`.
2. Open Reelsort, go to **Import & export**, and drop in the `.zip` (or `watched.csv` + `ratings.csv` from inside it).
3. On **Rank**, swipe the film card right if it's **better** than the film shown, left if it's **worse**. On a computer, use the arrow keys.
   - **Too close**: the film gets the same stars as the one it's compared to.
   - **Skip for now**: puts it at the end. **Don't remember it**: leaves it out.
   - **Undo** (or `Z`) takes back the last answer.
4. **Ranking** shows the full ordered list and the star spread. **Re-rank** puts a film through the comparisons again.
5. **Import & export → Download CSV**, then upload that file at letterboxd.com/import.

Progress saves automatically in the browser (and to your account when it runs as a published Claude artifact).

## How the stars are worked out

- Films you've **already rated** are fixed reference points. They start the ranking in star order and keep their ratings.
- Each unrated film is placed with a **binary search**: every answer halves the range it could land in, so placing a film among 500 others takes about 9 answers.
- The search **stops early** once every remaining spot falls between two reference films with the same rating, since more answers couldn't change its stars.
- A run of new films between two reference films is **spread evenly** across that gap and rounded to the nearest half star. A film between a 5★ and a 3★ lands at 4★; three films between 4★ and 3★ come out 4, 3½, 3. Above your best-rated film the ceiling is 5★; below your worst it's ½★.
- If you have no ratings at all, stars follow a typical spread by rank (most films 3–4★).

The export contains only the films rated here, so your existing Letterboxd ratings are left alone.

## Files

- `index.html` – the app (no build step).
- `ranker-core.js` – ranking, star and CSV logic, with no DOM code.
- `ranker-core.test.js` – tests: `node --test letterboxd-ranker/ranker-core.test.js`

To run locally: `cd letterboxd-ranker && python3 -m http.server`, then open http://localhost:8000.
