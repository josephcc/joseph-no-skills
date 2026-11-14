// webmcp-bridge-tray: a minimal macOS status-bar item driven by the webmcp-daemon over stdin/stdout.
// Protocol (one JSON object per line):
//   daemon → helper: {"type":"set","title":"● webmcp-bridge","image":"/path/to/icon.png","template":false,"icon":"<SF Symbol name>","tooltip":"…","items":[{"id":"status","title":"…","enabled":false},{"sep":true},{"id":"login","title":"Start at login","checked":true}]}
//     The button shows, in order of preference: the PNG at "image" (drawn at 18×18 pt; "template":true turns it into a
//     monochrome template image), else the SF Symbol named by "icon", else the "title" text. While a non-template image is
//     shown, the menu bar's legibility drop shadow is switched off (see setMenuBarShadow:), so a coloured logo has no halo.
//   helper → daemon: {"type":"ready"} once; {"type":"click","id":"login"} on each menu click.
// The helper exits when stdin closes, so the item disappears with the daemon. Built by scripts/build-tray.sh.
#import <Cocoa/Cocoa.h>

@interface Tray : NSObject <NSApplicationDelegate>
@property (strong) NSStatusItem *statusItem;
@property (strong) NSString *imagePath;   // path of the currently loaded "image", so repeated "set" frames don't reload it
@property (strong) NSImage *image;
@end

@implementation Tray
- (void)applicationDidFinishLaunching:(NSNotification *)note {
    // AppKit persists a status item's slot as "NSStatusItem Preferred Position <autosaveName>" (points from the right
    // edge). A brand-new item is dropped at the far left of the status area, which on a MacBook with a notch is often
    // *under* the notch and therefore invisible; so on first run ask for a slot inside the usual visible range.
    // The slot is read when the item is created, under the item's autosave name, which for the first item of a process is
    // "Item-0" (a custom name set afterwards is too late). 560 points from the right edge sits among the visible icons.
    NSUserDefaults *d = [NSUserDefaults standardUserDefaults];
    if (![d objectForKey:@"NSStatusItem Preferred Position Item-0"]) { [d setDouble:560 forKey:@"NSStatusItem Preferred Position Item-0"]; [d synchronize]; }
    self.statusItem = [[NSStatusBar systemStatusBar] statusItemWithLength:NSVariableStatusItemLength];
    self.statusItem.button.title = @"○ webmcp-bridge";
    self.statusItem.menu = [[NSMenu alloc] init];
    [self emit:@{@"type": @"ready"}];
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_UTILITY, 0), ^{ [self readLoop]; });
}
- (void)readLoop {
    NSFileHandle *in = [NSFileHandle fileHandleWithStandardInput];
    NSMutableData *buf = [NSMutableData data];
    for (;;) {
        NSData *chunk = [in availableData];
        if (chunk.length == 0) { dispatch_async(dispatch_get_main_queue(), ^{ [NSApp terminate:nil]; }); return; }   // daemon went away
        [buf appendData:chunk];
        for (;;) {
            NSRange nl = [buf rangeOfData:[NSData dataWithBytes:"\n" length:1] options:0 range:NSMakeRange(0, buf.length)];
            if (nl.location == NSNotFound) break;
            NSData *line = [buf subdataWithRange:NSMakeRange(0, nl.location)];
            [buf replaceBytesInRange:NSMakeRange(0, nl.location + 1) withBytes:NULL length:0];
            NSDictionary *msg = line.length ? [NSJSONSerialization JSONObjectWithData:line options:0 error:nil] : nil;
            if ([msg isKindOfClass:NSDictionary.class]) dispatch_async(dispatch_get_main_queue(), ^{ [self apply:msg]; });
        }
    }
}
- (void)apply:(NSDictionary *)msg {
    if (![msg[@"type"] isEqual:@"set"]) return;
    NSString *imagePath = [msg[@"image"] isKindOfClass:NSString.class] ? msg[@"image"] : nil;
    NSString *icon = [msg[@"icon"] isKindOfClass:NSString.class] ? msg[@"icon"] : nil;
    NSImage *img = nil;
    if (imagePath.length) {   // a PNG shipped next to the helper (the icon), loaded once per path
        if (![imagePath isEqualToString:self.imagePath]) { self.image = [[NSImage alloc] initWithContentsOfFile:imagePath]; self.imagePath = imagePath; }
        img = self.image;
        if (img) { img.size = NSMakeSize(18, 18); img.template = [msg[@"template"] boolValue]; }
    }
    if (!img && icon.length) {
        if (@available(macOS 11.0, *)) img = [NSImage imageWithSystemSymbolName:icon accessibilityDescription:@"webmcp-bridge"];
        if (img) { img.template = YES; }
    }
    if (img) { self.statusItem.button.image = img; self.statusItem.button.imagePosition = NSImageOnly; self.statusItem.button.title = @""; }
    else if ([msg[@"title"] isKindOfClass:NSString.class]) { self.statusItem.button.image = nil; self.statusItem.button.imagePosition = NSNoImage; self.statusItem.button.title = msg[@"title"]; }
    [self setMenuBarShadow:!(img && !img.template)];   // keep the system shadow for template glyphs and text; drop it for the logo
    if ([msg[@"tooltip"] isKindOfClass:NSString.class]) self.statusItem.button.toolTip = msg[@"tooltip"];
    NSArray *items = [msg[@"items"] isKindOfClass:NSArray.class] ? msg[@"items"] : @[];
    NSMenu *menu = [[NSMenu alloc] init];
    for (NSDictionary *it in items) {
        if (![it isKindOfClass:NSDictionary.class]) continue;
        if ([it[@"sep"] boolValue]) { [menu addItem:[NSMenuItem separatorItem]]; continue; }
        NSString *title = [it[@"title"] isKindOfClass:NSString.class] ? it[@"title"] : @"";
        NSMenuItem *mi = [[NSMenuItem alloc] initWithTitle:title action:@selector(clicked:) keyEquivalent:@""];
        mi.target = self;
        mi.representedObject = [it[@"id"] isKindOfClass:NSString.class] ? it[@"id"] : @"";
        mi.enabled = it[@"enabled"] ? [it[@"enabled"] boolValue] : YES;
        mi.state = [it[@"checked"] boolValue] ? NSControlStateValueOn : NSControlStateValueOff;
        [menu addItem:mi];
    }
    menu.autoenablesItems = NO;
    self.statusItem.menu = menu;
}
// In dark mode the menu bar draws a drop shadow behind every status item for legibility (a Core Animation shadow owned by
// the private NSStatusBarContentView, property hasCAShadow). Behind a white template glyph it is invisible; behind the
// coloured icon it reads as a dark halo, so it is switched off while the logo is shown. Private API, hence guarded
// and best-effort: if a future macOS drops the property the shadow simply stays. Re-applied on every "set" frame, since
// AppKit could reset it when the appearance changes.
- (void)setMenuBarShadow:(BOOL)on {
    NSView *cv = self.statusItem.button.window.contentView;
    if (!cv || ![cv respondsToSelector:NSSelectorFromString(@"setHasCAShadow:")]) return;
    @try { if ([[cv valueForKey:@"hasCAShadow"] boolValue] != on) [cv setValue:@(on) forKey:@"hasCAShadow"]; } @catch (NSException *e) { /* leave the system default */ }
}
- (void)clicked:(NSMenuItem *)sender { [self emit:@{@"type": @"click", @"id": sender.representedObject ?: @""}]; }
- (void)emit:(NSDictionary *)obj {
    NSData *d = [NSJSONSerialization dataWithJSONObject:obj options:0 error:nil];
    if (!d) return;
    NSMutableData *line = [d mutableCopy]; [line appendBytes:"\n" length:1];
    @try { [[NSFileHandle fileHandleWithStandardOutput] writeData:line]; } @catch (NSException *e) { [NSApp terminate:nil]; }
}
@end

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        NSApplication *app = [NSApplication sharedApplication];
        Tray *tray = [[Tray alloc] init];
        app.delegate = tray;
        [app setActivationPolicy:NSApplicationActivationPolicyAccessory];   // menu bar only; no Dock icon
        [app run];
    }
    return 0;
}
