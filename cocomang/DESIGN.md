# COCOMANG: meja petugas

## Direction

The user explicitly requested renaming Senandika to COCOMANG and revising the interface because it felt AI-generated. Continue the already active antislop during workflow; direct edits are authorized. Apply the core antislop and antislop-ui skill.

Design read: an Indonesian amusement-park registration counter for staff who must identify an unmeasured visitor, record their measurement, and check ride eligibility. A printed operations ledger next to a physical measuring instrument. ENERGY 2 / RHYTHM 2 / MOTION 1.

## Decisions and purpose

- Text-only COCOMANG wordmark in heavy sans capitals feels like park signage. No invented pictorial logo, profile photography or decorative illustration.
- Warm ticket-paper background, pine-green ink and one muted yellow accent reflect the park counter. The accent identifies registration and starting the sensor, not every UI component.
- Horizontal operational navigation replaces the generic full-height sidebar. Small ordered numbers identify workstations without repeating six generic icons.
- Four data totals share a ruled summary strip rather than four identical rounded cards. Values are computed from stored simulation data, without invented trends.
- Registration is the primary screen task. Visitor name and measured height appear before weight/RFID, bringing the access prerequisite into the scan path.
- Visitor avatars are removed from the ledger: initials added no identity evidence. Names are readable and row actions say Buka rather than using unexplained arrows.
- The measuring instrument is a separate dark surface because it represents the hardware workflow. Its 0/100/200 cm scale and dynamic marker represent the actual selected visitor height, not decorative lines. Text readout is authoritative; the visual scale caps at the 200 cm reference.
- The ride directory is a ruled list with aligned thresholds and controls, not six identical feature cards. Comparison of requirements is its job.
- Activity is a plain table of actual simulation records. Demo records remain labelled by the page's simulation context and footer.
- Typography uses available Arial Black/Segoe UI/Arial for park-sign character and clear forms. No external font request or large decorative monospace type.
- Radius: 3px inputs, 4px actions, 5px bounded surfaces, 8px dialogs. Circular shapes only for the help button and detail-view initials. No glow or glass effects. Shadows only for dialogs and transient feedback.
- Theme remains daylight-readable paper because this is a daytime front desk. The instrument panel is a functional region, not an alternate theme.
- Motion is only finite sensor-reading feedback and control state transitions. Reduced motion disables it.
- Mobile navigation scrolls within its own region; tables scroll within their own containers; layout collapses to one column. Controls have 44px touch targets, visible labels and focus.

## Integrity

The old localStorage namespace is intentionally retained so the rename cannot discard previously registered visitors. All visible brand text and download filenames use COCOMANG. The hosted project identity and existing URL remain the same because this is an edit to an existing Site. Firebase and hardware are not connected. No claim of native-browser visual verification is made without the browser tool.
