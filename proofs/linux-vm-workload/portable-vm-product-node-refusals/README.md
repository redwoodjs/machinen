# Portable VM product Node refusal rows

This retained artifact covers the product-path refusal boundary for Node.js live
state discovered during `machinen snapshot <vm> --portable` inventory.

The product path may classify Node package/process metadata, but it must refuse
unsafe live state instead of claiming raw Node/V8/process continuation.
