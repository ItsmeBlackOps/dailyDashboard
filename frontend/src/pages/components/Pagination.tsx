
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { 
  ChevronLeft, 
  ChevronRight, 
  ChevronsLeft, 
  ChevronsRight,
  MoreHorizontal
} from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';

const BasicPagination = ({ 
  currentPage, 
  totalPages, 
  onPageChange 
}: { 
  currentPage: number; 
  totalPages: number; 
  onPageChange: (page: number) => void;
}) => {
  return (
    <div className="flex items-center space-x-2">
      <Button 
        variant="outline" 
        size="sm"
        onClick={() => onPageChange(currentPage - 1)}
        disabled={currentPage <= 1}
      >
        <ChevronLeft className="h-4 w-4" />
        Previous
      </Button>
      
      <div className="flex items-center space-x-1">
        {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
          <Button
            key={page}
            variant={currentPage === page ? "default" : "outline"}
            size="sm"
            onClick={() => onPageChange(page)}
            className="w-10"
          >
            {page}
          </Button>
        ))}
      </div>

      <Button 
        variant="outline" 
        size="sm"
        onClick={() => onPageChange(currentPage + 1)}
        disabled={currentPage >= totalPages}
      >
        Next
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
};

const AdvancedPagination = ({ 
  currentPage, 
  totalPages, 
  onPageChange,
  showFirstLast = true,
  maxVisible = 5
}: { 
  currentPage: number; 
  totalPages: number; 
  onPageChange: (page: number) => void;
  showFirstLast?: boolean;
  maxVisible?: number;
}) => {
  const getVisiblePages = () => {
    const start = Math.max(1, currentPage - Math.floor(maxVisible / 2));
    const end = Math.min(totalPages, start + maxVisible - 1);
    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
  };

  const visiblePages = getVisiblePages();
  const showLeftEllipsis = visiblePages[0] > 2;
  const showRightEllipsis = visiblePages[visiblePages.length - 1] < totalPages - 1;

  return (
    <div className="flex items-center space-x-1">
      {showFirstLast && (
        <Button 
          variant="outline" 
          size="sm"
          onClick={() => onPageChange(1)}
          disabled={currentPage <= 1}
        >
          <ChevronsLeft className="h-4 w-4" />
        </Button>
      )}
      
      <Button 
        variant="outline" 
        size="sm"
        onClick={() => onPageChange(currentPage - 1)}
        disabled={currentPage <= 1}
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>

      {visiblePages[0] > 1 && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(1)}
          className="w-10"
        >
          1
        </Button>
      )}

      {showLeftEllipsis && (
        <Button variant="ghost" size="sm" disabled className="w-10">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      )}

      {visiblePages.map((page) => (
        <Button
          key={page}
          variant={currentPage === page ? "default" : "outline"}
          size="sm"
          onClick={() => onPageChange(page)}
          className="w-10"
        >
          {page}
        </Button>
      ))}

      {showRightEllipsis && (
        <Button variant="ghost" size="sm" disabled className="w-10">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      )}

      {visiblePages[visiblePages.length - 1] < totalPages && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(totalPages)}
          className="w-10"
        >
          {totalPages}
        </Button>
      )}

      <Button 
        variant="outline" 
        size="sm"
        onClick={() => onPageChange(currentPage + 1)}
        disabled={currentPage >= totalPages}
      >
        <ChevronRight className="h-4 w-4" />
      </Button>

      {showFirstLast && (
        <Button 
          variant="outline" 
          size="sm"
          onClick={() => onPageChange(totalPages)}
          disabled={currentPage >= totalPages}
        >
          <ChevronsRight className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
};

export default function ComponentPagination() {
  const [basicPage, setBasicPage] = useState(1);
  const [advancedPage, setAdvancedPage] = useState(5);
  const [compactPage, setCompactPage] = useState(1);
  const [tablePage, setTablePage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [jumpPage, setJumpPage] = useState('');

  const totalItems = 250;
  const totalPages = Math.ceil(totalItems / pageSize);

  const handleJumpToPage = () => {
    const page = parseInt(jumpPage);
    if (page >= 1 && page <= totalPages) {
      setTablePage(page);
      setJumpPage('');
    }
  };

  return (
    <DashboardLayout>
      <div className="container mx-auto p-6 space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Pagination</h1>
            <p className="text-muted-foreground">Navigation components for splitting content across multiple pages.</p>
          </div>
          <Badge variant="outline">Components</Badge>
        </div>

        <div className="grid gap-6">
          {/* Basic Pagination */}
          <Card>
            <CardHeader>
              <CardTitle>Basic Pagination</CardTitle>
              <CardDescription>Simple pagination with previous/next buttons and numbered pages.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex justify-center">
                  <BasicPagination 
                    currentPage={basicPage}
                    totalPages={7}
                    onPageChange={setBasicPage}
                  />
                </div>
                <div className="text-center text-sm text-muted-foreground">
                  Page {basicPage} of 7
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Advanced Pagination */}
          <Card>
            <CardHeader>
              <CardTitle>Advanced Pagination</CardTitle>
              <CardDescription>Pagination with ellipsis, first/last buttons, and smart page visibility.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex justify-center">
                  <AdvancedPagination 
                    currentPage={advancedPage}
                    totalPages={20}
                    onPageChange={setAdvancedPage}
                    maxVisible={5}
                  />
                </div>
                <div className="text-center text-sm text-muted-foreground">
                  Page {advancedPage} of 20 • Showing 5 pages maximum
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Compact Pagination */}
          <Card>
            <CardHeader>
              <CardTitle>Compact Pagination</CardTitle>
              <CardDescription>Minimal pagination for mobile or space-constrained layouts.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex justify-center">
                  <div className="flex items-center space-x-2">
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => setCompactPage(Math.max(1, compactPage - 1))}
                      disabled={compactPage <= 1}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    
                    <div className="px-3 py-1 text-sm bg-muted rounded">
                      {compactPage} / 15
                    </div>

                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => setCompactPage(Math.min(15, compactPage + 1))}
                      disabled={compactPage >= 15}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <div className="text-center text-sm text-muted-foreground">
                  Compact pagination for mobile devices
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Table Pagination */}
          <Card>
            <CardHeader>
              <CardTitle>Table Pagination</CardTitle>
              <CardDescription>Complete pagination solution with page size selector and jump-to-page functionality.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {/* Sample Table */}
                <div className="border rounded-lg">
                  <div className="grid grid-cols-4 gap-4 p-4 border-b font-medium">
                    <div>ID</div>
                    <div>Name</div>
                    <div>Email</div>
                    <div>Status</div>
                  </div>
                  {Array.from({ length: Math.min(pageSize, totalItems - (tablePage - 1) * pageSize) }, (_, i) => {
                    const itemIndex = (tablePage - 1) * pageSize + i + 1;
                    return (
                      <div key={i} className="grid grid-cols-4 gap-4 p-4 border-b last:border-b-0">
                        <div>#{itemIndex}</div>
                        <div>User {itemIndex}</div>
                        <div>user{itemIndex}@example.com</div>
                        <div>
                          <Badge variant={itemIndex % 3 === 0 ? "secondary" : "default"}>
                            {itemIndex % 3 === 0 ? "Inactive" : "Active"}
                          </Badge>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Pagination Controls */}
                <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                  <div className="flex items-center space-x-2 text-sm text-muted-foreground">
                    <span>Show</span>
                    <Select value={pageSize.toString()} onValueChange={(value) => {
                      setPageSize(parseInt(value));
                      setTablePage(1);
                    }}>
                      <SelectTrigger className="w-16">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="5">5</SelectItem>
                        <SelectItem value="10">10</SelectItem>
                        <SelectItem value="25">25</SelectItem>
                        <SelectItem value="50">50</SelectItem>
                      </SelectContent>
                    </Select>
                    <span>entries</span>
                  </div>

                  <AdvancedPagination 
                    currentPage={tablePage}
                    totalPages={totalPages}
                    onPageChange={setTablePage}
                    maxVisible={3}
                  />

                  <div className="flex items-center space-x-2">
                    <span className="text-sm text-muted-foreground">Jump to:</span>
                    <Input
                      type="number"
                      placeholder="Page"
                      value={jumpPage}
                      onChange={(e) => setJumpPage(e.target.value)}
                      onKeyPress={(e) => e.key === 'Enter' && handleJumpToPage()}
                      className="w-20"
                      min="1"
                      max={totalPages}
                    />
                    <Button size="sm" onClick={handleJumpToPage}>
                      Go
                    </Button>
                  </div>
                </div>

                <div className="text-sm text-muted-foreground text-center">
                  Showing {(tablePage - 1) * pageSize + 1} to {Math.min(tablePage * pageSize, totalItems)} of {totalItems} entries
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Different Styles */}
          <Card>
            <CardHeader>
              <CardTitle>Style Variations</CardTitle>
              <CardDescription>Different visual styles for pagination components.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                {/* Rounded Style */}
                <div className="space-y-2">
                  <h4 className="font-medium">Rounded Style</h4>
                  <div className="flex justify-center">
                    <div className="flex items-center space-x-1">
                      <Button variant="outline" size="sm" className="rounded-full w-8 h-8 p-0">
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      {[1, 2, 3, 4, 5].map((page) => (
                        <Button
                          key={page}
                          variant={page === 2 ? "default" : "outline"}
                          size="sm"
                          className="rounded-full w-8 h-8 p-0"
                        >
                          {page}
                        </Button>
                      ))}
                      <Button variant="outline" size="sm" className="rounded-full w-8 h-8 p-0">
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Pills Style */}
                <div className="space-y-2">
                  <h4 className="font-medium">Pills Style</h4>
                  <div className="flex justify-center">
                    <div className="flex items-center bg-muted rounded-full p-1">
                      <Button variant="ghost" size="sm" className="rounded-full h-8 px-3">
                        Previous
                      </Button>
                      {[1, 2, 3, 4].map((page) => (
                        <Button
                          key={page}
                          variant={page === 2 ? "secondary" : "ghost"}
                          size="sm"
                          className="rounded-full h-8 w-8 p-0"
                        >
                          {page}
                        </Button>
                      ))}
                      <Button variant="ghost" size="sm" className="rounded-full h-8 px-3">
                        Next
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Minimal Style */}
                <div className="space-y-2">
                  <h4 className="font-medium">Minimal Style</h4>
                  <div className="flex justify-center">
                    <div className="flex items-center space-x-4">
                      <Button variant="ghost" size="sm">
                        ← Previous
                      </Button>
                      <span className="text-sm text-muted-foreground">
                        2 of 10
                      </span>
                      <Button variant="ghost" size="sm">
                        Next →
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
