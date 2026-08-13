<img src="https://i.imgur.com/orwkU5q.png" style="max-width:75%">

# 0.6.6 Update Broke JSON
Scrap Mechanic's Nov 0.6.6 update broke the JSON export to file method, for a workaround see the github issue with [workaround]. I have emailed the developers about the issue but with the holidays will probably be a while for a response.

# Introduction
This quickly outputs the world data of your scrap mechanic save game to a json file for display via leafletJS from pre-screenshotted tiles. Not quite as beautiful as my [older screenshot method], but SOOOOOoooooo much quicker. This method is somewhat future proof as well. New tiles will still be displayed just blank, but updates should only require a new download of the missing tiles images.

## Current 1.0 browser map

The current browser application in `html/` builds on the original
[the1killer/sm_overview] project and its captured map images. The original
project and the reused material in this repository remain under the
[Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International
license][CC BY-NC-SA 4.0].

Scrap Mechanic and its game content are owned by Axolot Games AB. This is an
unofficial community project and is not affiliated with, endorsed by, or
supported by Axolot Games.

The 1.0 application reads a selected Survival v28 `.db` save locally in the
browser. It keeps the save's real cell layout, uses reviewed original images
where an official legacy mapping exists, and gives other valid 1.0 cells an
explicit terrain-category color. The save is not uploaded or persisted.

Legacy IDs are mapped to 1.0 tile UUIDs only from checked game-script
registrations such as `AddLegacyUpgrade` and `addPoiTileLegacy`. The generated
bridge records the source tile path, status, and evidence for review; similar
filename digits are never treated as tile identity.

From `html/`, rebuild and verify the public game data and legacy asset manifest
against a local Scrap Mechanic installation:

```powershell
npm.cmd run data:build -- --game-root "G:\共享文件\Scrap Mechanic"
npm.cmd run data:legacy -- --game-root "G:\共享文件\Scrap Mechanic"
npm.cmd run data:verify -- --game-root "G:\共享文件\Scrap Mechanic"
```

To add a reviewed render for a 1.0 cell that has no original image, create a
lossless PNG named `<uuid>__<xOffset>__<yOffset>.png`, review its source and
licensing, then pack it with `data:atlas` and rerun `data:verify`. This intake
adds a 1.0 render; it must not edit or infer a legacy-ID mapping. See
[`html/tools/game-data/atlas/README.md`](html/tools/game-data/atlas/README.md)
for the complete render contract.

Before a save is selected, the site intentionally shows useful fixed-region
references, POIs, search, and filters, but does not label a fabricated random
surface as the player's map. A complete Survival surface is generated per save;
publishing an invented layout would be misleading and would undermine the
local-save privacy boundary.

### Player markers

Use **Add Marker**, then choose a position on the map to create a private
`Resource`, `Danger`, `Base`, `Vehicle`, or `Note` marker. Select a marker from
the map or location list to edit it or delete it with confirmation.

Player markers are stored only in this browser and are isolated per map. The
built-in map has its own collection; each imported save layout restores only
the markers associated with that layout. Markers are not written to the save
file or uploaded. Clearing site data, resetting browser storage, or using a
different browser or device removes or hides that browser's markers, so keep a
separate record of anything important.

# Example
https://the1killer.github.io/scrapmechanictilemap/

# INSTRUCTIONS

!!!! BACKUP YOUR SAVE, not responsible for any issues !!!!

1. **Really backup your save!**
1. Download this repoistory, green "Code" button on the top right, or [Download Link]
1. Open `terrain_overworld.lua` from the downloaded files.
1. Copy lines 132-157, `local cells` *...to...* `cells = nil   end`
1. Open `terrain_overworld.lua` in your game files, e.x. C:\Program Files (x86)\Steam\steamapps\common\Scrap Mechanic\Survival\Scripts\terrain\terrain_overworld.lua
1. Paste the lines into the game's terrain_overworld.lua, approx **line 130**, after `CreateCellTileStorageKeys()` within the `Load()` Function.
1. Replace `tile_database.lua` in your game files with the one from the downloaded files. E.x. C:\Program Files (x86)\Steam\steamapps\common\Scrap Mechanic\Survival\Scripts\terrain\overworld\tile_database.lua
1. Load your save game.
1. Copy **cells.json** from your game files C:\Program Files (x86)\Steam\steamapps\common\Scrap Mechanic\Survival\ to the **html\assets\json directory** in the downloads.
1. <u>**If hosting on a webserver**</u>
    1. Copy all the files under **html/** to your webserver and open index.html and good to go.
1. <u>**If viewing locally**</u>
    1. Open **cells.json**, select all text (ctrl-a), copy all text
    1. Paste text into https://codebeautify.org/jsonminifier and click "minify/compress" then copy the resulting text on the right
    1. Open **html/index.html**, on line 26 `SMOverviewMap.init();` add two back ticks( ` ) inside the parentheses
    1. Paste the text from Part 2 inbetween the backticks. becomes `SMOverviewMap.init(`\``[[{......`\``);`
    1. Open **html/index.html** to view your map
1. If you wish, remove or comment (--) the added lines in terrain_overworld.lua to improve game loading times


## Some things to note
- Terrain height not really shown.
- Game updates will remove the lua changes, requiring you to re-add them
- How to setup your own free [GitHub website]
- I think there could be some missing road/cliff tiles as there are many possibilties on how they mesh with eachother. Create an issue with your map seed and I can try to capture them.


# Changelog
- v1.0.0
    - Initial Release

# Donation
If you love this project and want to see more features give the developer a cup of coffee!

[![paypal](https://www.paypalobjects.com/en_US/i/btn/btn_donateCC_LG.gif)](https://www.paypal.com/cgi-bin/webscr?cmd=_donations&business=7JF52HNLJNHFE&item_name=SM+Overview+Donations&currency_code=USD)


# Tutorial Video
Thanks to LionHeartBlue Gaming to making a tutorial video. Most people will need **Option 2** listed above and in the video. 
<br/>
Remember to enclose the JSON with back ticks **\`**.
<br/>
<br/>
[![Tutorial Video](https://img.youtube.com/vi/OXBzApCRwJA/sddefault.jpg))](https://www.youtube.com/watch?v=OXBzApCRwJA))


<br/>
<br/>
<br/>
<br/>
<br/>
<a rel="license" href="http://creativecommons.org/licenses/by-nc-sa/4.0/"><img alt="Creative Commons License" style="border-width:0" src="https://i.creativecommons.org/l/by-nc-sa/4.0/88x31.png" /></a><br />This work is licensed under a <a rel="license" href="http://creativecommons.org/licenses/by-nc-sa/4.0/">Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International License</a>.

Scrap Mechanic is property of Axolot Games AB, I have no affiliation with them.

[//]: # (Links)
[AutoHotKey]: https://www.autohotkey.com/
[GitHub website]: https://pages.github.com/
[Download Link]: https://github.com/the1killer/sm_overview/archive/main.zip
[older screenshot method]: https://github.com/the1killer/sm_overview_ahk
[Donate]: https://www.paypal.com/cgi-bin/webscr?cmd=_donations&business=7JF52HNLJNHFE&item_name=SM+Overview+Donations&currency_code=USD
[workaround]: https://github.com/the1killer/sm_overview/issues/17#issuecomment-1849092063
[the1killer/sm_overview]: https://github.com/the1killer/sm_overview
[CC BY-NC-SA 4.0]: https://creativecommons.org/licenses/by-nc-sa/4.0/
