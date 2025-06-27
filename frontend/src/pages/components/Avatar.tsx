
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';

export default function ComponentAvatar() {
  return (
    <DashboardLayout>
      <div className="container mx-auto p-6 space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Avatar</h1>
            <p className="text-muted-foreground">An image element with a fallback for representing the user.</p>
          </div>
          <Badge variant="outline">Components</Badge>
        </div>

        <div className="grid gap-6">
          {/* Image Avatar */}
          <Card>
            <CardHeader>
              <CardTitle>Image Avatar</CardTitle>
              <CardDescription>Avatar with profile images and fallback text.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-4">
                <Avatar>
                  <AvatarImage src="https://github.com/shadcn.png" alt="@shadcn" />
                  <AvatarFallback>CN</AvatarFallback>
                </Avatar>
                <Avatar>
                  <AvatarImage src="https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=32&h=32&fit=crop&crop=face" alt="@johndoe" />
                  <AvatarFallback>JD</AvatarFallback>
                </Avatar>
                <Avatar>
                  <AvatarImage src="https://images.unsplash.com/photo-1494790108755-2616b25c2996?w=32&h=32&fit=crop&crop=face" alt="@janedoe" />
                  <AvatarFallback>JD</AvatarFallback>
                </Avatar>
              </div>
            </CardContent>
          </Card>

          {/* Text Avatar */}
          <Card>
            <CardHeader>
              <CardTitle>Text Avatar</CardTitle>
              <CardDescription>Avatar with initials fallback when no image is available.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-4">
                <Avatar>
                  <AvatarFallback>AB</AvatarFallback>
                </Avatar>
                <Avatar>
                  <AvatarFallback>CD</AvatarFallback>
                </Avatar>
                <Avatar>
                  <AvatarFallback>EF</AvatarFallback>
                </Avatar>
                <Avatar>
                  <AvatarFallback>GH</AvatarFallback>
                </Avatar>
              </div>
            </CardContent>
          </Card>

          {/* Different Sizes */}
          <Card>
            <CardHeader>
              <CardTitle>Different Sizes</CardTitle>
              <CardDescription>Avatars in various sizes for different use cases.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-4">
                <Avatar className="h-6 w-6">
                  <AvatarFallback className="text-xs">XS</AvatarFallback>
                </Avatar>
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="text-xs">SM</AvatarFallback>
                </Avatar>
                <Avatar>
                  <AvatarFallback>MD</AvatarFallback>
                </Avatar>
                <Avatar className="h-12 w-12">
                  <AvatarFallback>LG</AvatarFallback>
                </Avatar>
                <Avatar className="h-16 w-16">
                  <AvatarFallback>XL</AvatarFallback>
                </Avatar>
              </div>
            </CardContent>
          </Card>

          {/* Status Badge Avatar */}
          <Card>
            <CardHeader>
              <CardTitle>Status Badge Avatar</CardTitle>
              <CardDescription>Avatars with status indicators.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-6">
                <div className="relative">
                  <Avatar>
                    <AvatarImage src="https://github.com/shadcn.png" alt="@shadcn" />
                    <AvatarFallback>CN</AvatarFallback>
                  </Avatar>
                  <div className="absolute -bottom-0 -right-0 h-3 w-3 rounded-full bg-green-500 border-2 border-background"></div>
                </div>
                <div className="relative">
                  <Avatar>
                    <AvatarFallback>JD</AvatarFallback>
                  </Avatar>
                  <div className="absolute -bottom-0 -right-0 h-3 w-3 rounded-full bg-yellow-500 border-2 border-background"></div>
                </div>
                <div className="relative">
                  <Avatar>
                    <AvatarFallback>AB</AvatarFallback>
                  </Avatar>
                  <div className="absolute -bottom-0 -right-0 h-3 w-3 rounded-full bg-red-500 border-2 border-background"></div>
                </div>
                <div className="relative">
                  <Avatar>
                    <AvatarFallback>XY</AvatarFallback>
                  </Avatar>
                  <div className="absolute -bottom-0 -right-0 h-3 w-3 rounded-full bg-gray-500 border-2 border-background"></div>
                </div>
              </div>
              <div className="mt-4 flex gap-4 text-sm text-muted-foreground">
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-green-500"></div>
                  <span>Online</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-yellow-500"></div>
                  <span>Away</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-red-500"></div>
                  <span>Busy</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-gray-500"></div>
                  <span>Offline</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
