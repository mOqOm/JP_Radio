# Volumio Plugin Review Checklist

## GENERAL

| Check | Expected Result | PASS | Documentation Reference |
| --- | --- | --- | --- |
| Does the plugin have a coherent name? | The plugin must be self-explanatory in its name, like "Simple Equalizer" | | https://developers.volumio.com/plugins/writing-a-plugin#volumio-plugin-init |
| Is the plugin archive less than 10 MB? | The plugin archive must be less than 10 MB | | |
| Does the plugin have a full english translation? | Plugin shall have a full english translation. | | |
| Does the plugin have additional translations? If yes, changing the language of system, does the plugin change its language? | Plugin shall automatically switch to a different language | | |
| Once the plugin is installed, is the available plugin list visible? | Yes. Otherwise the plugin has a non-compliant package.json | | https://developers.volumio.com/plugins/writing-a-plugin#packagejson-example |

## LIFECYCLE

| Check | Expected Result | PASS | Documentation Reference |
| --- | --- | --- | --- |
| Does the plugin start when clicking start, does the indicator become green? | Indicator becomes green, plugins start well | | https://developers.volumio.com/plugins/index-js#on-start |
| Create a typo in a function call on the onStart function. Does the system crash? | System does not crash | | |
| Does the plugin stop correctly when stopped? Are its functionalities disabled? | All plugins functionalities shall stop if plugin is set to stopped | | https://developers.volumio.com/plugins/index-js#on-stop |
| Does the plugin require some configuration before being started? | Plugin shall not need any configuration to be started and have sane defaults as configuration | | |
| If the plugin needs to start a daemon, does it do via systemctl? | Yes, all daemons shall be started via systemctl, not via exec or execSync | | https://developers.volumio.com/plugins/index-js#using-daemons |

## INSTALL

| Check | Expected Result | PASS | Documentation Reference |
| --- | --- | --- | --- |
| Does the plugin need to build modules or other components? | No, plugin shall not compile anything on user device | | https://developers.volumio.com/plugins/plugin-structure#installsh |
| Does the plugin need to write, edit or create folders on /volumio /myvolumio folders? | No, plugin does not need to modify any of those files | | https://developers.volumio.com/plugins/plugin-structure#installsh |
| Does the plugin re-install or overwrite utilities, configuration files or daemons already present? | No, plugin does not need to modify any of those files | | https://developers.volumio.com/plugins/plugin-structure#installsh |
| Does the plugin install libraries or anything similar (e.g. in /usr/local/lib)? | These files should remain in the plugin folder and only be symlinked to the system path (`ln -sf ...`) and not copied or moved. | | https://developers.volumio.com/plugins/plugin-structure#installsh |
| Does the plugin delete its plugin folder on a failed install? | Yes. If installation failed there should be a cleanup to not show a broken plugin. | | https://developers.volumio.com/plugins/plugin-structure#installsh |
| Does the plugin install.sh end with `echo "plugininstallend"`? | Yes, this way the installer knows installation is finished | | https://developers.volumio.com/plugins/plugin-structure#installsh |
| Does the installer script fetch external libraries/archives? If yes, is the URL hardcoded or dynamic? | The package/library URL shall be hardcoded and point to the same version. Pointing to /latest version or parsing of URL is not allowed | | https://developers.volumio.com/plugins/plugin-structure#installsh |

## RESILIENCY

| Check | Expected Result | PASS | Documentation Reference |
| --- | --- | --- | --- |
| Does the plugin use sync calls? If yes, are all of them properly handled by try/catch? | The sync functions shall always be wrapped in try/catch | | |

## MUSIC SERVICE

*(Applicable only if it's a music service plugin)*

| Check | Expected Result | PASS | Documentation Reference |
| --- | --- | --- | --- |
| Search any string, like Paolo or Pink or BBC. Do search results appear? | Yes, otherwise your plugin is breaking search. | | |
| Search any string that you know your plugin will return a result. Do results from your plugin appear? | Yes, otherwise your plugin is not returning search results correctly. | | |
| If plugin exposes a source, is the source icon white on transparent background? | Yes. Otherwise have a look at the other volumio icons and provide a 500px x 500px transparent PNG as icon | | |

## INTERACTION

| Check | Expected Result | PASS | Documentation Reference |
| --- | --- | --- | --- |
| Does this plugin work with convenience switching? (Play a file, then a radio, then Spotify Connect, does it work?) | Yes, Volumio switches sources without problems (no audio-device busy error) | | |
| Does the plugin impact audio playback? (Applicable mainly to plugins using AAMPP) | No, playback does not stutter, distort or exhibit poor performance when plugin is enabled | | https://developers.volumio.com/AAMPP/aampp-overview |
